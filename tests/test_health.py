async def test_health_returns_ok_without_api_key(client):
    response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert "version" in body


async def test_health_does_not_leak_internal_details(client):
    response = await client.get("/health")
    body = response.json()
    assert "database_url" not in body
    assert "api_key" not in {k.lower() for k in body}
    for value in body.values():
        assert "/data" not in str(value)
        assert "sqlite" not in str(value).lower()


async def test_health_returns_503_when_database_unavailable(client, monkeypatch):
    import app.main as main_module

    def broken_engine():
        raise RuntimeError("database connection pool exhausted")

    monkeypatch.setattr(main_module, "get_engine", broken_engine)

    response = await client.get("/health")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "error"
    assert body["database"] == "unavailable"
