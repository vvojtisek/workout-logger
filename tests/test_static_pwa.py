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


async def test_static_css_and_js_are_served(client):
    css_response = await client.get("/static/styles.css")
    assert css_response.status_code == 200
    js_response = await client.get("/static/app.js")
    assert js_response.status_code == 200
