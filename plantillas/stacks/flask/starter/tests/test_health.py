from flask.testing import FlaskClient

from src.core.config import get_settings


def test_health_ok(client: FlaskClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.get_json() == {"status": "ok"}


def test_unknown_route_is_json_404(client: FlaskClient) -> None:
    r = client.get("/no-existe")
    assert r.status_code == 404
    assert "error" in r.get_json()


def test_cors_only_for_allowed_origins(client: FlaskClient) -> None:
    for origin in get_settings().cors_list:
        r = client.get("/health", headers={"Origin": origin})
        assert r.headers["Access-Control-Allow-Origin"] == origin
    other = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "Access-Control-Allow-Origin" not in other.headers
