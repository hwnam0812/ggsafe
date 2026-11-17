import json
from pathlib import Path
import pytest
from streamlit.testing.v1 import AppTest
from ggsafe_streamlit import config, identity, storage


@pytest.mark.parametrize("unavailable", [False, True])
def test_signed_in_app_distinguishes_storage_setup_and_connection_failure(monkeypatch, unavailable):
    monkeypatch.delenv("GGSAFE_LOCAL_PREVIEW", raising=False)
    monkeypatch.delenv("GGSAFE_DATABASE_URL", raising=False)
    monkeypatch.setattr(config, "auth_available", lambda secrets: True)
    monkeypatch.setattr(config, "login_problem", lambda secrets, **kwargs: "")
    monkeypatch.setattr(identity, "verified_identity", lambda *args, **kwargs: identity.Identity("synthetic-owner", "synthetic@example.com", 9999999999))
    if unavailable:
        monkeypatch.setattr(config, "storage_settings", lambda secrets: {"database_url": "postgresql://synthetic"})
        def fail(*args, **kwargs):
            raise RuntimeError("synthetic-private-connection-value")
        monkeypatch.setattr(storage.Store, "prepare", fail)
    else:
        def missing(secrets):
            raise identity.PublicError("검사 이력을 오래 보관할 연결이 아직 준비되지 않았어요.", 503)
        monkeypatch.setattr(config, "storage_settings", missing)
    app = AppTest.from_file(Path(__file__).resolve().parents[1] / "streamlit_app.py")
    app.user = {"is_logged_in": True}
    app.run(timeout=15)
    assert len(app.exception) == 0
    component = app.get("component_instance")[0]
    args = json.loads(component.proto.json_args)
    session = args["session"]
    assert session["user"]["email"] == "synthetic@example.com"
    assert not session["storage_ready"] and session["storage_error"]
    assert session["error"] == ""
    assert "synthetic-private" not in json.dumps(args)
    assert ("연결하지 못했어요" in session["storage_error"]) == unavailable
