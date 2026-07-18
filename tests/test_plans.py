import uuid

BASE = "/api/v1/plans"


def make_plan_payload(**overrides) -> dict:
    payload = {
        "name": "Push Day",
        "description": "Chest, shoulders, triceps",
        "exercises": [],
    }
    payload.update(overrides)
    return payload


def make_exercise(name: str, sets: int = 3, reps_min: int = 5, reps_max: int = 8) -> dict:
    return {
        "exercise_name": name,
        "target_sets": sets,
        "target_reps_min": reps_min,
        "target_reps_max": reps_max,
        "target_weight_kg": 40,
        "rest_time_seconds": 90,
    }


async def test_create_plan_without_exercises(client, auth_headers):
    response = await client.post(
        BASE, json=make_plan_payload(name="Rest Day"), headers=auth_headers
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Rest Day"
    assert body["exercises"] == []
    assert "Location" in response.headers
    assert response.headers["Location"] == f"{BASE}/{body['id']}"


async def test_create_plan_with_multiple_exercises(client, auth_headers):
    payload = make_plan_payload(
        name="Pull Day",
        exercises=[make_exercise("Deadlift"), make_exercise("Row"), make_exercise("Pull-up")],
    )
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 201
    body = response.json()
    assert len(body["exercises"]) == 3


async def test_exercise_sort_order_matches_input_order(client, auth_headers):
    payload = make_plan_payload(
        name="Leg Day",
        exercises=[make_exercise("Squat"), make_exercise("Lunge"), make_exercise("Calf Raise")],
    )
    response = await client.post(BASE, json=payload, headers=auth_headers)
    body = response.json()
    ordered_names = [e["exercise_name"] for e in body["exercises"]]
    assert ordered_names == ["Squat", "Lunge", "Calf Raise"]
    assert [e["sort_order"] for e in body["exercises"]] == [0, 1, 2]


async def test_get_plan_detail(client, auth_headers):
    create_resp = await client.post(
        BASE, json=make_plan_payload(name="Full Body"), headers=auth_headers
    )
    plan_id = create_resp.json()["id"]

    response = await client.get(f"{BASE}/{plan_id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["id"] == plan_id


async def test_list_plans_pagination_and_ordering(client, auth_headers):
    for name in ["Charlie Plan", "Alpha Plan", "Bravo Plan"]:
        await client.post(BASE, json=make_plan_payload(name=name), headers=auth_headers)

    response = await client.get(f"{BASE}?limit=2&offset=0", headers=auth_headers)
    body = response.json()
    assert body["limit"] == 2
    assert body["offset"] == 0
    assert body["total"] == 3
    assert len(body["items"]) == 2
    assert [p["name"] for p in body["items"]] == ["Alpha Plan", "Bravo Plan"]

    response2 = await client.get(f"{BASE}?limit=2&offset=2", headers=auth_headers)
    assert [p["name"] for p in response2.json()["items"]] == ["Charlie Plan"]


async def test_replace_plan_updates_fields(client, auth_headers):
    create_resp = await client.post(
        BASE, json=make_plan_payload(name="Old Name", description="old"), headers=auth_headers
    )
    plan_id = create_resp.json()["id"]

    replace_payload = make_plan_payload(name="New Name", description="new")
    response = await client.put(f"{BASE}/{plan_id}", json=replace_payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "New Name"
    assert body["description"] == "new"


async def test_replace_plan_with_name_taken_by_another_plan_returns_409(client, auth_headers):
    await client.post(BASE, json=make_plan_payload(name="Taken Name"), headers=auth_headers)
    create_resp = await client.post(
        BASE, json=make_plan_payload(name="Original Name"), headers=auth_headers
    )
    plan_id = create_resp.json()["id"]

    response = await client.put(
        f"{BASE}/{plan_id}", json=make_plan_payload(name="taken name"), headers=auth_headers
    )
    assert response.status_code == 409
    assert response.json()["code"] == "PLAN_NAME_CONFLICT"

    unchanged = await client.get(f"{BASE}/{plan_id}", headers=auth_headers)
    assert unchanged.json()["name"] == "Original Name"


async def test_replace_nonexistent_plan_returns_404(client, auth_headers):
    response = await client.put(
        f"{BASE}/{uuid.uuid4()}", json=make_plan_payload(), headers=auth_headers
    )
    assert response.status_code == 404


async def test_delete_nonexistent_plan_returns_404(client, auth_headers):
    response = await client.delete(f"{BASE}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404


async def test_replace_plan_replaces_exercise_collection(client, auth_headers):
    create_payload = make_plan_payload(name="Original", exercises=[make_exercise("Bench")])
    create_resp = await client.post(BASE, json=create_payload, headers=auth_headers)
    plan_id = create_resp.json()["id"]

    replace_payload = make_plan_payload(
        name="Original", exercises=[make_exercise("Squat"), make_exercise("Deadlift")]
    )
    response = await client.put(f"{BASE}/{plan_id}", json=replace_payload, headers=auth_headers)
    body = response.json()
    assert [e["exercise_name"] for e in body["exercises"]] == ["Squat", "Deadlift"]

    get_resp = await client.get(f"{BASE}/{plan_id}", headers=auth_headers)
    assert len(get_resp.json()["exercises"]) == 2


async def test_delete_plan(client, auth_headers):
    create_resp = await client.post(
        BASE, json=make_plan_payload(name="To Delete"), headers=auth_headers
    )
    plan_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"{BASE}/{plan_id}", headers=auth_headers)
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"{BASE}/{plan_id}", headers=auth_headers)
    assert get_resp.status_code == 404


async def test_delete_plan_cascades_to_plan_exercises(client, auth_headers):
    payload = make_plan_payload(name="Cascade Plan", exercises=[make_exercise("Bench")])
    create_resp = await client.post(BASE, json=payload, headers=auth_headers)
    plan_id = create_resp.json()["id"]

    await client.delete(f"{BASE}/{plan_id}", headers=auth_headers)

    get_resp = await client.get(f"{BASE}/{plan_id}", headers=auth_headers)
    assert get_resp.status_code == 404


async def test_get_nonexistent_plan_returns_404(client, auth_headers):
    response = await client.get(f"{BASE}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "PLAN_NOT_FOUND"


async def test_create_plan_with_duplicate_name_returns_409(client, auth_headers):
    await client.post(BASE, json=make_plan_payload(name="Duplicate Plan"), headers=auth_headers)
    response = await client.post(
        BASE, json=make_plan_payload(name="duplicate plan"), headers=auth_headers
    )
    assert response.status_code == 409
    assert response.json()["code"] == "PLAN_NAME_CONFLICT"


async def test_create_plan_with_invalid_exercise_rolls_back_entire_transaction(
    client, auth_headers
):
    invalid_exercise = make_exercise("Bad Exercise")
    invalid_exercise["target_reps_min"] = 10
    invalid_exercise["target_reps_max"] = 5

    payload = make_plan_payload(
        name="Should Not Exist", exercises=[make_exercise("Good Exercise"), invalid_exercise]
    )
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422

    list_resp = await client.get(BASE, headers=auth_headers)
    names = [p["name"] for p in list_resp.json()["items"]]
    assert "Should Not Exist" not in names


async def test_invalid_uuid_path_param_returns_422(client, auth_headers):
    response = await client.get(f"{BASE}/not-a-uuid", headers=auth_headers)
    assert response.status_code == 422
