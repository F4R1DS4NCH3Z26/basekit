from fastapi.testclient import TestClient

from src.core.config import get_settings


def test_health_ok(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_cors_only_for_allowed_origins(client: TestClient) -> None:
    for origin in get_settings().cors_list:
        r = client.get("/health", headers={"Origin": origin})
        assert r.headers["access-control-allow-origin"] == origin
    other = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in other.headers
