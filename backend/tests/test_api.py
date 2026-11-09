import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path / "test.db"))


def test_seeds_a_default_plan(client):
    plans = client.get("/api/plans").json()
    assert len(plans) == 1
    record = client.get(f"/api/plans/{plans[0]['id']}").json()
    assert [s["id"] for s in record["config"]["stages"]][:2] == ["setup", "growth"]
    assert {f["id"] for f in record["config"]["facilities"]} == {"home", "external"}


def test_plan_crud_round_trip(client):
    config = client.get("/api/defaults").json()
    config["name"] = "Pallet every fortnight"
    created = client.post("/api/plans", json=config)
    assert created.status_code == 201
    pid = created.json()["id"]

    config["stages"][3]["slots"]["every_n_weeks"] = 2
    updated = client.put(f"/api/plans/{pid}", json=config).json()
    assert updated["config"]["stages"][3]["slots"]["every_n_weeks"] == 2
    assert client.get(f"/api/plans/{pid}").json()["name"] == "Pallet every fortnight"

    assert client.delete(f"/api/plans/{pid}").status_code == 204
    assert client.get(f"/api/plans/{pid}").status_code == 404


def test_schedule_endpoint_returns_three_scenarios(client):
    config = client.get("/api/defaults").json()
    res = client.post("/api/schedule", json=config)
    assert res.status_code == 200
    body = res.json()
    assert set(body["scenarios"]) == {"optimistic", "typical", "pessimistic"}
    typical = body["scenarios"]["typical"]
    assert len(typical["batches"]) == len(config["batches"])
    assert typical["departures"], "default plan has a weekly pallet"


def test_external_shutdown_delays_collection(client):
    config = client.get("/api/defaults").json()
    first_start = config["batches"][0]["start_date"]
    before = client.post("/api/schedule", json=config).json()["scenarios"]["typical"]["batches"][0]

    ext = next(f for f in config["facilities"] if f["id"] == "external")
    # External site shut from the first batch's start until its original finish date.
    ext["calendar"]["closures"] = [{"start": first_start, "end": before["end"], "label": "Shutdown"}]
    after = client.post("/api/schedule", json=config).json()["scenarios"]["typical"]["batches"][0]
    assert after["end"] > before["end"]


def test_oversized_batch_returns_422_with_reason(client):
    config = client.get("/api/defaults").json()
    config["batches"][0]["pucks"] = 100  # > 9 dewars x 7 pucks
    res = client.post("/api/schedule", json=config)
    assert res.status_code == 422 and "100 pucks" in res.json()["detail"]


def test_invalid_plan_is_rejected(client):
    config = client.get("/api/defaults").json()
    config["stages"][0]["min_days"] = 99
    assert client.post("/api/schedule", json=config).status_code == 422
