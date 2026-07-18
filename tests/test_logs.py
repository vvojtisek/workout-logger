import uuid
from datetime import datetime, timezone

LOGS = "/api/v1/logs"
PLANS = "/api/v1/plans"


def iso(dt: datetime) -> str:
    return dt.isoformat()


def make_log_payload(**overrides) -> dict:
    payload = {
        "performed_at": iso(datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)),
        "total_time_minutes": 45,
        "overall_feeling": 4,
        "exercises": [],
    }
    payload.update(overrides)
    return payload


def make_exercise_log(name: str = "Bench Press") -> dict:
    return {
        "exercise_name": name,
        "sets_count": 3,
        "reps_per_set": [10, 10, 8],
        "weight_kg": 80,
        "rest_time_seconds": 90,
    }


async def create_plan(client, auth_headers, name: str) -> str:
    resp = await client.post(PLANS, json={"name": name, "exercises": []}, headers=auth_headers)
    return resp.json()["id"]


async def test_create_log_without_plan(client, auth_headers):
    response = await client.post(LOGS, json=make_log_payload(), headers=auth_headers)
    assert response.status_code == 201
    body = response.json()
    assert body["source_plan_id"] is None
    assert body["source_plan_name"] is None


async def test_create_log_with_source_plan_id(client, auth_headers):
    plan_id = await create_plan(client, auth_headers, "Push Day Plan")
    response = await client.post(
        LOGS, json=make_log_payload(source_plan_id=plan_id), headers=auth_headers
    )
    assert response.status_code == 201
    body = response.json()
    assert body["source_plan_id"] == plan_id


async def test_create_log_snapshots_plan_name(client, auth_headers):
    plan_id = await create_plan(client, auth_headers, "Snapshot Plan")
    response = await client.post(
        LOGS, json=make_log_payload(source_plan_id=plan_id), headers=auth_headers
    )
    body = response.json()
    assert body["source_plan_name"] == "Snapshot Plan"

    await client.put(
        f"{PLANS}/{plan_id}",
        json={"name": "Renamed Plan", "exercises": []},
        headers=auth_headers,
    )
    get_resp = await client.get(f"{LOGS}/{body['id']}", headers=auth_headers)
    assert get_resp.json()["source_plan_name"] == "Snapshot Plan"


async def test_create_log_with_nonexistent_plan_returns_404(client, auth_headers):
    response = await client.post(
        LOGS, json=make_log_payload(source_plan_id=str(uuid.uuid4())), headers=auth_headers
    )
    assert response.status_code == 404
    assert response.json()["code"] == "PLAN_NOT_FOUND"


async def test_get_log_detail(client, auth_headers):
    create_resp = await client.post(
        LOGS, json=make_log_payload(exercises=[make_exercise_log()]), headers=auth_headers
    )
    log_id = create_resp.json()["id"]

    response = await client.get(f"{LOGS}/{log_id}", headers=auth_headers)
    assert response.status_code == 200
    assert len(response.json()["exercises"]) == 1


async def test_logs_ordered_newest_first(client, auth_headers):
    older = make_log_payload(performed_at=iso(datetime(2026, 1, 1, tzinfo=timezone.utc)))
    newer = make_log_payload(performed_at=iso(datetime(2026, 3, 1, tzinfo=timezone.utc)))
    await client.post(LOGS, json=older, headers=auth_headers)
    await client.post(LOGS, json=newer, headers=auth_headers)

    response = await client.get(LOGS, headers=auth_headers)
    performed_dates = [item["performed_at"] for item in response.json()["items"]]
    assert performed_dates == sorted(performed_dates, reverse=True)


async def test_filter_logs_by_date_range(client, auth_headers):
    in_range = make_log_payload(performed_at=iso(datetime(2026, 5, 15, tzinfo=timezone.utc)))
    out_of_range = make_log_payload(performed_at=iso(datetime(2026, 8, 1, tzinfo=timezone.utc)))
    await client.post(LOGS, json=in_range, headers=auth_headers)
    await client.post(LOGS, json=out_of_range, headers=auth_headers)

    response = await client.get(
        f"{LOGS}?date_from=2026-05-01T00:00:00Z&date_to=2026-06-01T00:00:00Z",
        headers=auth_headers,
    )
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["performed_at"].startswith("2026-05-15")


async def test_filter_logs_by_source_plan_id(client, auth_headers):
    plan_a = await create_plan(client, auth_headers, "Plan A")
    plan_b = await create_plan(client, auth_headers, "Plan B")
    await client.post(LOGS, json=make_log_payload(source_plan_id=plan_a), headers=auth_headers)
    await client.post(LOGS, json=make_log_payload(source_plan_id=plan_b), headers=auth_headers)

    response = await client.get(f"{LOGS}?source_plan_id={plan_a}", headers=auth_headers)
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["source_plan_id"] == plan_a


async def test_logs_pagination(client, auth_headers):
    for day in range(1, 4):
        await client.post(
            LOGS,
            json=make_log_payload(performed_at=iso(datetime(2026, 2, day, tzinfo=timezone.utc))),
            headers=auth_headers,
        )

    response = await client.get(f"{LOGS}?limit=2&offset=0", headers=auth_headers)
    body = response.json()
    assert body["total"] == 3
    assert len(body["items"]) == 2


async def test_replace_log_updates_fields(client, auth_headers):
    create_resp = await client.post(LOGS, json=make_log_payload(), headers=auth_headers)
    log_id = create_resp.json()["id"]

    replace_payload = make_log_payload(total_time_minutes=60, overall_feeling=5)
    response = await client.put(f"{LOGS}/{log_id}", json=replace_payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["total_time_minutes"] == 60
    assert body["overall_feeling"] == 5


async def test_replace_log_replaces_exercise_collection(client, auth_headers):
    create_payload = make_log_payload(exercises=[make_exercise_log("Bench Press")])
    create_resp = await client.post(LOGS, json=create_payload, headers=auth_headers)
    log_id = create_resp.json()["id"]

    replace_payload = make_log_payload(
        exercises=[make_exercise_log("Squat"), make_exercise_log("Deadlift")]
    )
    response = await client.put(f"{LOGS}/{log_id}", json=replace_payload, headers=auth_headers)
    body = response.json()
    assert [e["exercise_name"] for e in body["exercises"]] == ["Squat", "Deadlift"]


async def test_delete_log(client, auth_headers):
    create_resp = await client.post(LOGS, json=make_log_payload(), headers=auth_headers)
    log_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"{LOGS}/{log_id}", headers=auth_headers)
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"{LOGS}/{log_id}", headers=auth_headers)
    assert get_resp.status_code == 404


async def test_delete_log_cascades_to_exercise_logs(client, auth_headers):
    payload = make_log_payload(exercises=[make_exercise_log()])
    create_resp = await client.post(LOGS, json=payload, headers=auth_headers)
    log_id = create_resp.json()["id"]

    await client.delete(f"{LOGS}/{log_id}", headers=auth_headers)

    get_resp = await client.get(f"{LOGS}/{log_id}", headers=auth_headers)
    assert get_resp.status_code == 404


async def test_log_survives_deletion_of_source_plan(client, auth_headers):
    plan_id = await create_plan(client, auth_headers, "Temporary Plan")
    create_resp = await client.post(
        LOGS, json=make_log_payload(source_plan_id=plan_id), headers=auth_headers
    )
    log_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"{PLANS}/{plan_id}", headers=auth_headers)
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"{LOGS}/{log_id}", headers=auth_headers)
    assert get_resp.status_code == 200
    body = get_resp.json()
    assert body["source_plan_id"] is None
    assert body["source_plan_name"] == "Temporary Plan"
