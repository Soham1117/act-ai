"""Phase 0 smoke test: app imports and /health responds without external deps."""

from fastapi.testclient import TestClient


def test_health_ok(monkeypatch):
    # Avoid opening a real DB pool during the unit smoke test.
    import act_ai.main as main

    async def _noop():
        return None

    monkeypatch.setattr(main, "init_pool", _noop)
    monkeypatch.setattr(main, "close_pool", _noop)

    with TestClient(main.app) as client:
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
