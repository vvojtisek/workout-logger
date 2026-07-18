import json
import logging


async def test_access_log_contains_required_fields(client, auth_headers, caplog):
    with caplog.at_level(logging.INFO, logger="workout_logger.access"):
        response = await client.get("/api/v1/plans", headers=auth_headers)
    assert response.status_code == 200

    records = [r for r in caplog.records if r.name == "workout_logger.access"]
    assert records, "expected at least one access log record"
    record = records[-1]
    assert record.request_id
    assert record.method == "GET"
    assert record.path == "/api/v1/plans"
    assert record.status_code == 200
    assert isinstance(record.duration_ms, float)


def _app_records(caplog):
    return [r for r in caplog.records if r.name.startswith("workout_logger")]


async def test_api_key_never_appears_in_logs(client, auth_headers, caplog):
    secret = auth_headers["X-API-Key"]
    with caplog.at_level(logging.DEBUG):
        response = await client.get("/api/v1/plans", headers=auth_headers)
    assert response.status_code == 200

    records = _app_records(caplog)
    assert records
    for record in records:
        assert secret not in record.getMessage()
        for value in record.__dict__.values():
            assert secret not in str(value)


async def test_request_body_not_logged(client, auth_headers, caplog):
    payload = {"name": "Secret Squirrel Plan", "exercises": []}
    with caplog.at_level(logging.DEBUG):
        response = await client.post("/api/v1/plans", json=payload, headers=auth_headers)
    assert response.status_code == 201

    records = _app_records(caplog)
    assert records
    for record in records:
        assert "Secret Squirrel Plan" not in record.getMessage()
        for value in record.__dict__.values():
            assert "Secret Squirrel Plan" not in str(value)


async def test_unhandled_exception_returns_generic_response(
    client, auth_headers, monkeypatch, caplog
):
    from app.api.v1 import plans as plans_api

    async def boom(*args, **kwargs):
        raise RuntimeError("simulated database failure at /data/workout_logger.db")

    monkeypatch.setattr(plans_api.plans_service, "list_plans", boom)

    with caplog.at_level(logging.ERROR):
        response = await client.get("/api/v1/plans", headers=auth_headers)

    assert response.status_code == 500
    body = response.json()
    assert body["code"] == "INTERNAL_ERROR"
    assert body["detail"] == "Internal server error"
    assert "request_id" in body
    assert "/data/workout_logger.db" not in json.dumps(body)
    assert "RuntimeError" not in json.dumps(body)

    error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert error_records
    assert any("simulated database failure" in r.getMessage() or r.exc_text for r in error_records)
