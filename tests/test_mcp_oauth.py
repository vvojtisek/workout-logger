"""OAuth 2.1 discovery and challenge behavior for the MCP transport.

Token validation itself (issuer/audience/expiry/signature/allowlist) is
covered end-to-end in `tests/test_mcp_server.py`, alongside real tool calls.
This file covers the discovery surface a standards-compliant MCP client
(MCP Inspector, ChatGPT) walks before it ever presents a token.
"""

import httpx


async def test_protected_resource_metadata_is_served_at_the_domain_root(client):
    response = await client.get("/.well-known/oauth-protected-resource/mcp/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert body["resource"] == "https://fitness.example.test/mcp/"
    assert body["authorization_servers"] == ["https://idp.example.test/"]
    assert set(body["scopes_supported"]) == {"read", "log"}
    # `admin` is a REST-only scope and must never be offered to MCP clients.
    assert "admin" not in body["scopes_supported"]


async def test_protected_resource_metadata_matches_between_root_and_mount(client):
    """FastMCP also serves its own copy of this route nested under the `/mcp`
    mount (harmless -- no client looks there); the root-level copy added in
    app/main.py is the one RFC 9728 clients actually discover, and both must
    describe the same resource."""
    root = await client.get("/.well-known/oauth-protected-resource/mcp/")
    nested = await client.get("/mcp/.well-known/oauth-protected-resource/mcp/")
    assert root.status_code == nested.status_code == 200
    assert root.json() == nested.json()


async def test_unauthenticated_mcp_post_returns_oauth_challenge_not_a_bare_401_body(client):
    from app.main import app

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as raw:
            response = await raw.post(
                "http://testserver/mcp/",
                json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
                headers={"Accept": "application/json, text/event-stream"},
            )
    assert response.status_code == 401
    assert "WWW-Authenticate" in response.headers
    challenge = response.headers["WWW-Authenticate"]
    assert challenge.startswith("Bearer")
    assert "resource_metadata=" in challenge
    # Must not be the old REST-style bare-key error body.
    assert response.text != '{"detail":"Invalid or missing API key"}'


async def test_bare_mcp_path_redirects_to_the_trailing_slash_form(client):
    response = await client.get("/mcp", follow_redirects=False)
    assert response.status_code == 308
    assert response.headers["location"] == "/mcp/"
