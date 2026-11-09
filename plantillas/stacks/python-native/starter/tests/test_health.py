from src.core.config import get_settings
from src.core.testing import TestClient


def test_health_ok(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_unknown_route_is_json_404(client: TestClient) -> None:
    r = client.get("/no-existe")
    assert r.status_code == 404
    assert "error" in r.json()


def test_wrong_method_is_405_with_allow(client: TestClient) -> None:
    r = client.post("/health", json={})
    assert r.status_code == 405
    assert "GET" in r.headers["Allow"]


def test_head_has_no_body(client: TestClient) -> None:
    r = client.request("HEAD", "/health")
    assert r.status_code == 200
    assert r.body == b""


def test_cors_only_for_allowed_origins(client: TestClient) -> None:
    for origin in get_settings().cors_list:
        r = client.get("/health", headers={"Origin": origin})
        assert r.headers["Access-Control-Allow-Origin"] == origin
    other = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "Access-Control-Allow-Origin" not in other.headers
