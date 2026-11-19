import re
import struct


async def test_root_returns_html(client):
    response = await client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "<html" in response.text.lower()


async def test_manifest_has_correct_mime_type(client):
    response = await client.get("/manifest.webmanifest")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/manifest+json")


async def test_manifest_contains_192_and_512_icons(client):
    response = await client.get("/manifest.webmanifest")
    body = response.json()
    sizes = {icon["sizes"] for icon in body["icons"]}
    assert "192x192" in sizes
    assert "512x512" in sizes


async def test_browser_and_android_icons_are_served_with_their_declared_sizes(client):
    shell = (await client.get("/")).text
    favicons = re.findall(
        r'<link rel="icon" type="image/png" sizes="([^"]+)" href="([^"]+)"', shell
    )
    assert {size for size, _ in favicons} == {"16x16", "32x32"}

    manifest = (await client.get("/manifest.webmanifest")).json()
    icons = {(icon["sizes"], icon.get("purpose", "any")): icon["src"] for icon in manifest["icons"]}
    assert set(icons) >= {("192x192", "any"), ("512x512", "any"), ("512x512", "maskable")}
    pngs = {}
    for size, path in favicons + [(size, path) for (size, _), path in icons.items()]:
        image = await client.get(path)
        assert image.status_code == 200
        assert image.headers["content-type"] == "image/png"
        assert image.content.startswith(b"\x89PNG\r\n\x1a\n")
        assert struct.unpack(">II", image.content[16:24]) == tuple(map(int, size.split("x")))
        pngs[path] = image.content

    assert pngs[icons[("512x512", "any")]] != pngs[icons[("512x512", "maskable")]]


async def test_service_worker_available_at_root_path(client):
    response = await client.get("/sw.js")
    assert response.status_code == 200
    assert "javascript" in response.headers["content-type"]


async def test_service_worker_does_not_cache_api_v1(client):
    response = await client.get("/sw.js")
    body = response.text
    assert '"/api/v1"' in body
    never_cache_line = next(line for line in body.splitlines() if "NEVER_CACHE_PREFIXES" in line)
    assert "/api/v1" in never_cache_line


async def test_html_does_not_contain_api_key(client, auth_headers):
    response = await client.get("/")
    assert auth_headers["X-API-Key"] not in response.text


async def test_html_does_not_load_tailwind_cdn(client):
    response = await client.get("/")
    assert "cdn.tailwindcss.com" not in response.text
    assert "unpkg.com" not in response.text
    assert "jsdelivr.net" not in response.text


async def test_security_headers_present(client):
    response = await client.get("/")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert "camera=()" in response.headers["Permissions-Policy"]
    csp = response.headers["Content-Security-Policy"]
    assert "default-src 'self'" in csp
    assert "object-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp


async def test_only_the_mcp_consent_page_may_use_inline_styles(client):
    """FastMCP renders the OAuth consent page with an inline <style>; the
    app-wide `style-src 'self'` would leave it unstyled. Only that page gets
    'unsafe-inline' styles, and still no inline scripts."""
    consent = (await client.get("/mcp/consent?txn_id=unknown")).headers["Content-Security-Policy"]
    assert "style-src 'self' 'unsafe-inline'" in consent
    assert "script-src 'self';" in consent
    assert "frame-ancestors 'none'" in consent
    for path in ("/health", "/mcp/", "/api/v1/exercises"):
        csp = (await client.get(path)).headers["Content-Security-Policy"]
        assert "unsafe-inline" not in csp, path


async def test_hsts_absent_over_plain_http(client):
    response = await client.get("/")
    assert "Strict-Transport-Security" not in response.headers


async def test_hsts_present_over_https(app_engine):
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="https://testserver") as https_client:
        response = await https_client.get("/")
    assert response.headers["Strict-Transport-Security"] == "max-age=31536000; includeSubDomains"


async def test_every_asset_referenced_by_the_shell_is_served(client):
    """The bundle is content-hashed, so assert on what the shell actually asks for."""
    response = await client.get("/")
    referenced = re.findall(r'(?:src|href)="(/static/dist/[^"]+)"', response.text)
    assert referenced, "the built shell references no hashed assets"
    for asset_path in referenced:
        asset_response = await client.get(asset_path)
        assert asset_response.status_code == 200, f"{asset_path} is not served"


async def test_root_serves_the_compiled_single_page_application(client):
    response = await client.get("/")
    assert '<div id="root">' in response.text
    assert "/static/dist/assets/" in response.text
