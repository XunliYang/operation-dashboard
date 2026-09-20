"""/healthz 与统一响应包装。"""

from app.core.response import REQUEST_ID_HEADER

REQUIRED_KEYS = {"code", "message", "data", "request_id"}


def test_healthz_returns_200_and_envelope(client):
    resp = client.get("/healthz")

    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == REQUIRED_KEYS
    assert body["code"] == 0
    assert body["message"] == "ok"
    assert body["data"]["status"] == "ok"
    assert isinstance(body["request_id"], str) and body["request_id"]


def test_healthz_echoes_incoming_request_id(client):
    resp = client.get("/healthz", headers={REQUEST_ID_HEADER: "trace-abc-123"})

    assert resp.status_code == 200
    assert resp.json()["request_id"] == "trace-abc-123"
    assert resp.headers[REQUEST_ID_HEADER] == "trace-abc-123"


def test_healthz_generates_request_id_when_absent(client):
    resp = client.get("/healthz")

    rid = resp.json()["request_id"]
    assert rid not in {"", "-", None}
    assert resp.headers[REQUEST_ID_HEADER] == rid


def test_unknown_route_is_wrapped(client):
    resp = client.get("/definitely-not-a-route")

    assert resp.status_code == 404
    body = resp.json()
    assert set(body) == REQUIRED_KEYS
    assert body["code"] != 0
    assert body["data"] is None


def test_openapi_documents_healthz(app):
    paths = app.openapi()["paths"]
    assert "/healthz" in paths
    assert "get" in paths["/healthz"]
