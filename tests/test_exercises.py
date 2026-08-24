import uuid

BASE = "/api/v1/exercises"


def make_exercise_payload(**overrides) -> dict:
    payload = {
        "name": "Barbell Bench Press",
        "aliases": ["Bench Press", "Flat Bench"],
        "media_url": "https://example.com/videos/bench-press.mp4",
        "primary_muscles": ["chest", "triceps"],
        "secondary_muscles": ["shoulders"],
        "instructions": ["Lie on the bench.", "Lower the bar to the chest.", "Press up."],
        "equipment": "Barbell",
        "safety_notes": "Use a spotter for heavy sets.",
    }
    payload.update(overrides)
    return payload


async def test_create_exercise_with_full_fields(client, auth_headers):
    response = await client.post(BASE, json=make_exercise_payload(), headers=auth_headers)
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Barbell Bench Press"
    assert body["aliases"] == ["Bench Press", "Flat Bench"]
    assert body["primary_muscles"] == ["chest", "triceps"]
    assert "Location" in response.headers
    assert response.headers["Location"] == f"{BASE}/{body['id']}"


async def test_create_exercise_with_minimal_fields(client, auth_headers):
    payload = make_exercise_payload(
        name="Air Squat",
        aliases=[],
        media_url=None,
        primary_muscles=["quads"],
        secondary_muscles=[],
        instructions=[],
        equipment=None,
        safety_notes=None,
    )
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 201
    body = response.json()
    assert body["media_url"] is None
    assert body["instructions"] == []


async def test_create_exercise_with_http_media_url_returns_422(client, auth_headers):
    payload = make_exercise_payload(media_url="http://example.com/videos/bench-press.mp4")
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_create_exercise_with_javascript_media_url_returns_422(client, auth_headers):
    payload = make_exercise_payload(media_url="javascript:alert(1)")
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_create_exercise_with_invalid_muscle_tag_returns_422(client, auth_headers):
    payload = make_exercise_payload(primary_muscles=["abs"])
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_create_exercise_with_blank_alias_returns_422(client, auth_headers):
    payload = make_exercise_payload(aliases=["  "])
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_create_exercise_with_duplicate_name_returns_409(client, auth_headers):
    await client.post(
        BASE, json=make_exercise_payload(name="Duplicate Exercise"), headers=auth_headers
    )
    response = await client.post(
        BASE, json=make_exercise_payload(name="duplicate exercise"), headers=auth_headers
    )
    assert response.status_code == 409
    assert response.json()["code"] == "EXERCISE_NAME_CONFLICT"


async def test_get_exercise_detail(client, auth_headers):
    create_resp = await client.post(
        BASE, json=make_exercise_payload(name="Deadlift"), headers=auth_headers
    )
    exercise_id = create_resp.json()["id"]

    response = await client.get(f"{BASE}/{exercise_id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["id"] == exercise_id


async def test_get_nonexistent_exercise_returns_404(client, auth_headers):
    response = await client.get(f"{BASE}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404
    assert response.json()["code"] == "EXERCISE_NOT_FOUND"


async def test_list_exercises_pagination_and_ordering(client, auth_headers):
    for name in ["Charlie Curl", "Alpha Curl", "Bravo Curl"]:
        await client.post(BASE, json=make_exercise_payload(name=name), headers=auth_headers)

    response = await client.get(f"{BASE}?limit=2&offset=0", headers=auth_headers)
    body = response.json()
    assert body["limit"] == 2
    assert body["offset"] == 0
    assert body["total"] == 3
    assert len(body["items"]) == 2
    assert [e["name"] for e in body["items"]] == ["Alpha Curl", "Bravo Curl"]

    response2 = await client.get(f"{BASE}?limit=2&offset=2", headers=auth_headers)
    assert [e["name"] for e in response2.json()["items"]] == ["Charlie Curl"]


async def test_replace_exercise_updates_fields(client, auth_headers):
    create_resp = await client.post(
        BASE, json=make_exercise_payload(name="Old Name"), headers=auth_headers
    )
    exercise_id = create_resp.json()["id"]

    replace_payload = make_exercise_payload(name="New Name", equipment="Dumbbell")
    response = await client.put(f"{BASE}/{exercise_id}", json=replace_payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "New Name"
    assert body["equipment"] == "Dumbbell"


async def test_replace_exercise_with_name_taken_by_another_returns_409(client, auth_headers):
    await client.post(BASE, json=make_exercise_payload(name="Taken Name"), headers=auth_headers)
    create_resp = await client.post(
        BASE, json=make_exercise_payload(name="Original Name"), headers=auth_headers
    )
    exercise_id = create_resp.json()["id"]

    response = await client.put(
        f"{BASE}/{exercise_id}",
        json=make_exercise_payload(name="taken name"),
        headers=auth_headers,
    )
    assert response.status_code == 409
    assert response.json()["code"] == "EXERCISE_NAME_CONFLICT"

    unchanged = await client.get(f"{BASE}/{exercise_id}", headers=auth_headers)
    assert unchanged.json()["name"] == "Original Name"


async def test_replace_nonexistent_exercise_returns_404(client, auth_headers):
    response = await client.put(
        f"{BASE}/{uuid.uuid4()}", json=make_exercise_payload(), headers=auth_headers
    )
    assert response.status_code == 404


async def test_delete_exercise(client, auth_headers):
    create_resp = await client.post(
        BASE, json=make_exercise_payload(name="To Delete"), headers=auth_headers
    )
    exercise_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"{BASE}/{exercise_id}", headers=auth_headers)
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"{BASE}/{exercise_id}", headers=auth_headers)
    assert get_resp.status_code == 404


async def test_delete_nonexistent_exercise_returns_404(client, auth_headers):
    response = await client.delete(f"{BASE}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404


async def test_invalid_uuid_path_param_returns_422(client, auth_headers):
    response = await client.get(f"{BASE}/not-a-uuid", headers=auth_headers)
    assert response.status_code == 422
