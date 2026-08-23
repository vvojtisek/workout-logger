import csv
import io
import json
import zipfile

BASE = "/api/v1/export"


async def _seed_plan(client, auth_headers) -> str:
    response = await client.post(
        "/api/v1/plans",
        json={
            "name": "Export Push Day",
            "exercises": [
                {
                    "exercise_name": "Bench Press",
                    "target_sets": 3,
                    "target_reps_min": 5,
                    "target_reps_max": 8,
                }
            ],
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    return response.json()["id"]


async def test_export_json_is_empty_but_present_for_every_domain_with_no_data(client, auth_headers):
    response = await client.get(f"{BASE}?format=json", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {
        "plans",
        "exercises",
        "programs",
        "scheduled_workouts",
        "sessions",
        "body_metrics",
        "foods",
        "nutrition_plans",
        "meal_entries",
        "sleep_entries",
        "step_counts",
    }
    assert all(rows == [] for rows in body.values())


async def test_export_json_includes_seeded_data(client, auth_headers):
    await _seed_plan(client, auth_headers)
    response = await client.get(f"{BASE}?format=json", headers=auth_headers)
    body = response.json()
    assert len(body["plans"]) == 1
    assert body["plans"][0]["name"] == "Export Push Day"
    assert len(body["plans"][0]["exercises"]) == 1


async def test_export_json_excludes_api_tokens(client, auth_headers):
    await client.post(
        "/api/v1/tokens", json={"name": "MCP", "scopes": ["read"]}, headers=auth_headers
    )
    response = await client.get(f"{BASE}?format=json", headers=auth_headers)
    assert "api_tokens" not in response.json()


async def test_export_defaults_to_json_format(client, auth_headers):
    response = await client.get(BASE, headers=auth_headers)
    assert response.headers["content-type"].startswith("application/json")


async def test_export_json_sets_a_download_filename(client, auth_headers):
    response = await client.get(f"{BASE}?format=json", headers=auth_headers)
    disposition = response.headers["content-disposition"]
    assert "attachment" in disposition
    assert disposition.endswith('.json"')


async def test_export_csv_returns_a_zip_with_one_file_per_domain(client, auth_headers):
    response = await client.get(f"{BASE}?format=csv", headers=auth_headers)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["content-disposition"].endswith('.zip"')

    archive = zipfile.ZipFile(io.BytesIO(response.content))
    assert set(archive.namelist()) == {
        "plans.csv",
        "exercises.csv",
        "programs.csv",
        "scheduled_workouts.csv",
        "sessions.csv",
        "body_metrics.csv",
        "foods.csv",
        "nutrition_plans.csv",
        "meal_entries.csv",
        "sleep_entries.csv",
        "step_counts.csv",
    }


async def test_export_csv_flattens_nested_fields_into_json_cells(client, auth_headers):
    await _seed_plan(client, auth_headers)
    response = await client.get(f"{BASE}?format=csv", headers=auth_headers)
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    plans_csv = archive.read("plans.csv").decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(plans_csv)))
    assert len(rows) == 1
    assert rows[0]["name"] == "Export Push Day"
    exercises = json.loads(rows[0]["exercises"])
    assert exercises[0]["exercise_name"] == "Bench Press"


async def test_export_requires_authentication(client):
    response = await client.get(BASE)
    assert response.status_code == 401


async def test_export_is_reachable_with_a_read_scoped_token(client, auth_headers):
    created = await client.post(
        "/api/v1/tokens", json={"name": "read-only", "scopes": ["read"]}, headers=auth_headers
    )
    read_only_key = created.json()["token"]
    response = await client.get(BASE, headers={"X-API-Key": read_only_key})
    assert response.status_code == 200
