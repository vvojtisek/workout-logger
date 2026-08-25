import pytest


async def test_health_returns_ok_without_api_key(client):
    response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert "version" in body
    assert "commit" in body
    assert "build_time" in body


async def test_health_deployment_metadata_matches_settings(client):
    import app.main as main_module

    response = await client.get("/health")
    body = response.json()
    assert body["version"] == main_module.settings.APP_VERSION
    assert body["commit"] == main_module.settings.GIT_COMMIT
    assert body["build_time"] == main_module.settings.BUILD_TIME


async def test_deployment_metadata_headers_present_and_match_health(client):
    response = await client.get("/health")
    body = response.json()
    assert response.headers["X-App-Version"] == body["version"]
    assert response.headers["X-Git-Commit"] == body["commit"]
    assert response.headers["X-Build-Time"] == body["build_time"]


async def test_liveness_does_not_check_database(client, monkeypatch):
    import app.main as main_module

    def broken_engine():
        raise RuntimeError("database connection pool exhausted")

    monkeypatch.setattr(main_module, "get_engine", broken_engine)

    response = await client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "database": "not_checked",
        "version": main_module.settings.APP_VERSION,
        "commit": main_module.settings.GIT_COMMIT,
        "build_time": main_module.settings.BUILD_TIME,
    }


@pytest.mark.parametrize("path", ["/health/ready", "/health/startup"])
async def test_dependency_health_endpoints_return_ok(client, path):
    response = await client.get(path)
    assert response.status_code == 200
    assert response.json()["database"] == "ok"


async def test_health_does_not_leak_internal_details(client):
    response = await client.get("/health")
    body = response.json()
    assert "database_url" not in body
    assert "api_key" not in {k.lower() for k in body}
    for value in body.values():
        assert "/data" not in str(value)
        assert "sqlite" not in str(value).lower()


@pytest.mark.parametrize("path", ["/health", "/health/ready", "/health/startup"])
async def test_dependency_health_returns_503_when_database_unavailable(client, monkeypatch, path):
    import app.main as main_module

    def broken_engine():
        raise RuntimeError("database connection pool exhausted")

    monkeypatch.setattr(main_module, "get_engine", broken_engine)

    response = await client.get(path)
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "error"
    assert body["database"] == "unavailable"
