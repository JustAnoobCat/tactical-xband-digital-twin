"""
tests/test_server.py - FastAPI & WebSocket Integration Verification
Tactical X-Band Air-to-Ground Network Digital Twin
"""

import asyncio
from fastapi.testclient import TestClient
import pytest

from server.app import app, sim


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_rest_config_endpoints(client):
    """Validates /api/config GET snapshot and POST live configuration updates."""
    # 1. Snapshot Query
    resp_get = client.get("/api/config")
    assert resp_get.status_code == 200
    data = resp_get.json()
    assert "carrier_freq_ghz" in data
    assert "orbit_a_m" in data
    assert "coverage_radius_km" in data
    assert data["scheduler_mode"] in ("tac_tad", "static")

    # 2. Live Configuration Update
    payload = {
        "carrier_freq_ghz": 8.5,
        "coverage_radius_km": 40.0,
        "rain_rate_mmh": 12.0,
    }
    resp_post = client.post("/api/config", json=payload)
    assert resp_post.status_code == 200
    res_json = resp_post.json()
    assert res_json["ok"] is True
    assert res_json["applied"]["carrier_freq_ghz"] == 8.5
    assert res_json["applied"]["coverage_radius_km"] == 40.0


def test_rest_node_move_and_traffic_inject(client):
    """Validates node movement and traffic injection endpoints."""
    # Move soldier terminal
    move_payload = {"node_id": 4, "x_m": 2500.0, "y_m": -3200.0}
    resp_move = client.post("/api/node/move", json=move_payload)
    assert resp_move.status_code == 200
    assert resp_move.json()["ok"] is True

    # Inject SOS Alert
    inject_payload = {"node_id": 4, "traffic_type": "SOS"}
    resp_inj = client.post("/api/traffic/inject", json=inject_payload)
    assert resp_inj.status_code == 200
    assert resp_inj.json()["ok"] is True
    assert resp_inj.json()["enqueued_pkts"] > 0


def test_rest_sim_control(client):
    """Validates playback simulation control (Pause, Resume, Speed)."""
    resp_pause = client.post("/api/control", json={"action": "PAUSE"})
    assert resp_pause.status_code == 200
    assert resp_pause.json()["state"]["speed"] == 0.0

    resp_resume = client.post("/api/control", json={"action": "RESUME"})
    assert resp_resume.status_code == 200
    assert resp_resume.json()["state"]["speed"] > 0.0


def test_simulation_tick_and_frame_schema():
    """Directly verifies simulation engine frame output schema and coordinates."""
    sim.reset()
    frame = asyncio.run(sim.tick_simulation())

    # ACN Telemetry Schema
    assert "acn_telemetry" in frame
    acn = frame["acn_telemetry"]
    assert "pos_x" in acn and isinstance(acn["pos_x"], (int, float))
    assert "pos_y" in acn and isinstance(acn["pos_y"], (int, float))
    assert "pos_z" in acn and isinstance(acn["pos_z"], (int, float))
    assert "flight_path" in acn and len(acn["flight_path"]) > 0

    # Ground Nodes Telemetry Schema
    assert "nodes_telemetry" in frame
    nodes = frame["nodes_telemetry"]
    assert len(nodes) == 16
    for n in nodes:
        assert "x_m" in n and isinstance(n["x_m"], (int, float))
        assert "y_m" in n and isinstance(n["y_m"], (int, float))
        assert "z_m" in n and isinstance(n["z_m"], (int, float))
        assert "node_id" in n
        assert "state_name" in n


def test_websocket_telemetry_stream(client):
    """Validates real-time 50 Hz WebSocket stream connection and payload integrity."""
    with client.websocket_connect("/ws") as ws:
        # Receive first live telemetry frame
        data = ws.receive_json()

        assert "frame_index" in data
        assert "sim_time_s" in data
        assert "comparative_kpi_dashboard" in data

        # Check ACN Telemetry
        assert "acn_telemetry" in data
        acn = data["acn_telemetry"]
        assert "pos_x" in acn
        assert "pos_y" in acn
        assert "pos_z" in acn
        assert "flight_path" in acn

        # Check Ground Nodes Telemetry Schema (x_m, y_m, z_m)
        assert "nodes_telemetry" in data
        assert len(data["nodes_telemetry"]) == 16
        for node in data["nodes_telemetry"]:
            assert "x_m" in node
            assert "y_m" in node
            assert "z_m" in node
            assert "node_id" in node
            assert "state_name" in node

        # Send control command over WebSocket
        ws.send_json({"type": "SELECT_NODE", "node_id": 4})
        next_frame = ws.receive_json()
        assert next_frame["selected_node_id"] == 4