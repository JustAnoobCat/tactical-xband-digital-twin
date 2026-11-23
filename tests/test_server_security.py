"""
tests/test_server_security.py - Security, Concurrency & Parity Test Suite
Tactical X-Band Air-to-Ground Network Digital Twin
"""

import asyncio
import json
import math
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from server.app import app, sim


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_cors_allowed_localhost_origins(client):
    """Verifies that loopback origins are permitted with proper CORS headers."""
    # 1. Vite dev server on localhost:5173
    resp_get = client.get("/api/capabilities", headers={"Origin": "http://localhost:5173"})
    assert resp_get.status_code == 200
    assert resp_get.headers.get("access-control-allow-origin") == "http://localhost:5173"

    # 2. Loopback 127.0.0.1:4173 preflight
    resp_options = client.options(
        "/api/config",
        headers={
            "Origin": "http://127.0.0.1:4173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert resp_options.status_code == 200
    assert resp_options.headers.get("access-control-allow-origin") == "http://127.0.0.1:4173"


def test_cors_rejected_external_origin(client):
    """Verifies that arbitrary external origins are not reflected in CORS headers."""
    resp = client.get("/api/capabilities", headers={"Origin": "https://evil.example.com"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") is None


def test_cors_dynamic_env_override(client, monkeypatch):
    """Verifies that XBAND_CORS_ORIGINS allows specifying custom authorized origins."""
    custom_origin = "https://c2.ladakh-sector.drdo.gov.in"
    monkeypatch.setenv("XBAND_CORS_ORIGINS", f"{custom_origin}, https://tac-node.mil")
    resp = client.get("/api/capabilities", headers={"Origin": custom_origin})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == custom_origin


def test_token_auth_unset_allows_all(client, monkeypatch):
    """Verifies default zero-config development when XBAND_API_TOKEN is unset."""
    monkeypatch.delenv("XBAND_API_TOKEN", raising=False)

    # Mutating POST allowed without token
    resp_config = client.post("/api/config", json={"rain_rate_mmh": 5.0})
    assert resp_config.status_code == 200
    assert resp_config.json()["ok"] is True

    resp_move = client.post("/api/node/move", json={"node_id": 2, "x_m": 1000.0, "y_m": 1000.0})
    assert resp_move.status_code == 200
    assert resp_move.json()["ok"] is True

    # WebSocket connects without token
    with client.websocket_connect("/ws") as ws:
        frame = ws.receive_json()
        assert "frame_index" in frame


def test_token_auth_mutating_rejected_when_set(client, monkeypatch):
    """Verifies that missing or invalid tokens reject mutating routes with 401."""
    token = "secret-token-def-456"
    monkeypatch.setenv("XBAND_API_TOKEN", token)

    # 1. Missing token on POST -> 401
    resp_no_token = client.post("/api/node/move", json={"node_id": 1, "x_m": 0.0, "y_m": 0.0})
    assert resp_no_token.status_code == 401
    assert resp_no_token.json()["ok"] is False

    # 2. Invalid X-API-Key -> 401
    resp_bad_key = client.post(
        "/api/node/move",
        json={"node_id": 1, "x_m": 0.0, "y_m": 0.0},
        headers={"X-API-Key": "wrong-token"},
    )
    assert resp_bad_key.status_code == 401

    # 3. Invalid Bearer token -> 401
    resp_bad_bearer = client.post(
        "/api/node/move",
        json={"node_id": 1, "x_m": 0.0, "y_m": 0.0},
        headers={"Authorization": "Bearer invalid-token"},
    )
    assert resp_bad_bearer.status_code == 401

    # 4. Read-only GET routes remain accessible without credentials
    resp_get_cap = client.get("/api/capabilities")
    assert resp_get_cap.status_code == 200
    resp_get_cfg = client.get("/api/config")
    assert resp_get_cfg.status_code == 200


def test_token_auth_mutating_accepted_when_valid(client, monkeypatch):
    """Verifies that valid X-API-Key or Bearer tokens are accepted on mutating routes."""
    token = "drdo-secure-token-789"
    monkeypatch.setenv("XBAND_API_TOKEN", token)

    # 1. Valid X-API-Key
    resp_key = client.post(
        "/api/node/move",
        json={"node_id": 3, "x_m": 500.0, "y_m": 500.0},
        headers={"X-API-Key": token},
    )
    assert resp_key.status_code == 200
    assert resp_key.json()["ok"] is True

    # 2. Valid Authorization: Bearer
    resp_bearer = client.post(
        "/api/traffic/inject",
        json={"node_id": 3, "traffic_type": "SOS"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp_bearer.status_code == 200
    assert resp_bearer.json()["ok"] is True


def test_token_auth_websocket_enforcement(client, monkeypatch):
    """Verifies that WebSocket connections require valid token when XBAND_API_TOKEN is set."""
    token = "classified-ws-auth-321"
    monkeypatch.setenv("XBAND_API_TOKEN", token)

    # 1. Missing token -> policy violation 1008
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/ws"):
            pass
    assert exc_info.value.code == 1008

    # 2. Wrong token in query param -> policy violation 1008
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/ws?token=incorrect"):
            pass
    assert exc_info.value.code == 1008

    # 3. Valid token in query param -> connects and receives telemetry
    with client.websocket_connect(f"/ws?token={token}") as ws:
        frame = ws.receive_json()
        assert "frame_index" in frame

    # 4. Valid token in header -> connects
    with client.websocket_connect("/ws", headers={"X-API-Key": token}) as ws:
        frame = ws.receive_json()
        assert "frame_index" in frame


def test_input_bounds_and_finiteness_validation(client):
    """Verifies that NaN, Inf, and out-of-range values return 400 clean error responses."""
    json_headers = {"Content-Type": "application/json"}

    # 1. NaN coordinate in node/move (serialized with allow_nan=True)
    nan_payload = json.dumps({"node_id": 2, "x_m": float("nan"), "y_m": 0.0}, allow_nan=True)
    resp_nan = client.post("/api/node/move", content=nan_payload, headers=json_headers)
    assert resp_nan.status_code in (400, 422)

    # 2. Inf coordinate in node/move
    inf_payload = json.dumps({"node_id": 2, "x_m": 0.0, "y_m": float("inf")}, allow_nan=True)
    resp_inf = client.post("/api/node/move", content=inf_payload, headers=json_headers)
    assert resp_inf.status_code in (400, 422)

    # 3. Invalid node_id in node/move
    resp_node = client.post("/api/node/move", json={"node_id": 999, "x_m": 0.0, "y_m": 0.0})
    assert resp_node.status_code == 400

    # 4. NaN in config update
    cfg_nan = json.dumps({"rain_rate_mmh": float("nan")}, allow_nan=True)
    resp_cfg_nan = client.post("/api/config", content=cfg_nan, headers=json_headers)
    assert resp_cfg_nan.status_code in (400, 422)

    # 5. Out-of-range negative frequency in config
    resp_cfg_bound = client.post("/api/config", json={"carrier_freq_ghz": -10.0})
    assert resp_cfg_bound.status_code == 400

    # 6. NaN in playback control speed
    speed_nan = json.dumps({"action": "SET_SPEED", "speed": float("nan")}, allow_nan=True)
    resp_speed_nan = client.post("/api/control", content=speed_nan, headers=json_headers)
    assert resp_speed_nan.status_code in (400, 422)

    # 7. Negative playback speed in control
    resp_speed_neg = client.post("/api/control", json={"action": "SET_SPEED", "speed": -5.0})
    assert resp_speed_neg.status_code == 400

    # 8. Invalid node_id in traffic inject
    resp_inj_node = client.post("/api/traffic/inject", json={"node_id": 50, "traffic_type": "SOS"})
    assert resp_inj_node.status_code == 400

    # 9. Unsupported traffic type in traffic inject
    resp_inj_type = client.post("/api/traffic/inject", json={"node_id": 0, "traffic_type": "INVALID_CORRUPT"})
    assert resp_inj_type.status_code == 400


def test_simulation_tick_recovery_after_bad_inputs(client):
    """Verifies that rejecting corrupted input payloads does not compromise subsequent ticks."""
    sim.reset()
    json_headers = {"Content-Type": "application/json"}
    bad_move = json.dumps({"node_id": 0, "x_m": float("nan"), "y_m": float("inf")}, allow_nan=True)
    client.post("/api/node/move", content=bad_move, headers=json_headers)
    bad_cfg = json.dumps({"rain_rate_mmh": float("nan")}, allow_nan=True)
    client.post("/api/config", content=bad_cfg, headers=json_headers)

    # Execute simulation tick
    frame = asyncio.run(sim.tick_simulation())
    assert "acn_telemetry" in frame
    assert math.isfinite(frame["acn_telemetry"]["pos_x"])
    assert math.isfinite(frame["acn_telemetry"]["pos_y"])
    assert math.isfinite(frame["acn_telemetry"]["pos_z"])
    assert len(frame["nodes_telemetry"]) == 16


def test_capabilities_schema(client):
    """Validates the GET /api/capabilities structured schema and architectural role."""
    resp = client.get("/api/capabilities")
    assert resp.status_code == 200
    data = resp.json()

    # Core identity
    assert data["engine"] == "python-reference-backend"
    assert data["canonical_runtime"] == "typescript-web-worker"
    assert data["parity_status"] == "reference-subset"
    assert data["frequency_hz"] == 50
    assert data["timestep_s"] == 0.02

    # Model Taxonomy
    assert "python_core_models" in data
    assert "link_budget" in data["python_core_models"]
    assert "queues" in data["python_core_models"]
    assert "scheduler" in data["python_core_models"]
    assert "terrain" in data["python_core_models"]
    assert "trajectory" in data["python_core_models"]

    # TypeScript-Only Features
    assert "typescript_only_features" in data
    assert isinstance(data["typescript_only_features"], list)
    assert "web_worker_discrete_event_loop" in data["typescript_only_features"]
    assert "quad_sector_antenna_switching" in data["typescript_only_features"]
