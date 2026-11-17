from copy import deepcopy
import sqlite3
import pytest
from ggsafe_streamlit.config import GOOGLE_METADATA, auth_available, login_problem, storage_settings
from ggsafe_streamlit.identity import PublicError
from ggsafe_streamlit.storage import Store, storage_retry

def config():
    return {"auth": {"redirect_uri": "https://synthetic.example/oauth2callback", "cookie_secret": "synthetic-" * 8,
        "google": {"client_id": "synthetic-id", "client_secret": "synthetic-secret", "server_metadata_url": GOOGLE_METADATA, "client_kwargs": {"scope": "openid email"}}}}

def test_minimal_google_scope_and_no_exposed_tokens():
    assert auth_available(config())
    for change in ("metadata", "scope", "tokens", "callback", "cookie"):
        value = deepcopy(config())
        if change == "metadata": value["auth"]["google"]["server_metadata_url"] = "https://other.example"
        if change == "scope": value["auth"]["google"]["client_kwargs"]["scope"] = "openid email profile"
        if change == "tokens": value["auth"]["expose_tokens"] = ["access"]
        if change == "callback": value["auth"]["redirect_uri"] = "http://public.example/oauth2callback"
        if change == "cookie": value["auth"]["cookie_secret"] = "short"
        assert not auth_available(value)

def test_hosted_app_never_silently_uses_ephemeral_storage(monkeypatch):
    monkeypatch.delenv("GGSAFE_LOCAL_PREVIEW", raising=False)
    monkeypatch.delenv("GGSAFE_DATABASE_URL", raising=False)
    with pytest.raises(PublicError):
        storage_settings({})
    assert storage_settings({"storage": {"database_url": "postgresql://synthetic"}}) == {"database_url": "postgresql://synthetic"}

def test_retry_is_bounded_and_never_retries_unrelated_errors():
    pauses, calls = [], []
    def busy():
        calls.append(1)
        raise sqlite3.OperationalError("database is locked")
    with pytest.raises(sqlite3.OperationalError):
        storage_retry(busy, pauses.append)
    assert len(calls) == 5 and pauses == [0.025, 0.06, 0.12, 0.22]
    with pytest.raises(ValueError):
        storage_retry(lambda: (_ for _ in ()).throw(ValueError()), lambda ms: pytest.fail("재시도하면 안 돼요"))

def test_reapplying_schema_preserves_rows(store):
    store.query("INSERT INTO ggsafe_rate (rate_key,count,window_start) VALUES ('synthetic',1,0)")
    store.prepare()
    assert store.query("SELECT count FROM ggsafe_rate")[0]["count"] == 1

def test_invalid_remote_database_scheme_is_rejected():
    with pytest.raises(PublicError):
        Store(database_url="http://not-a-database.example")

@pytest.mark.parametrize("settings", [None, {"auth": None}, {"auth": {"google": None}}, {"auth": {"google": {"client_kwargs": None}}}, {"auth": {"redirect_uri": 123}}, {"auth": {"redirect_uri": "https://[bad/oauth2callback"}}])
def test_invalid_auth_configuration_shows_setup_state_instead_of_crashing(settings):
    assert not auth_available(settings)

@pytest.mark.parametrize("url", ["https:///oauth2callback", "https://user:password@example.com/oauth2callback", "https://example.com/oauth2callback?secret=example", "https://example.com/oauth2callback#fragment"])
def test_callback_must_have_clean_origin_and_no_query(url):
    settings = config()
    settings["auth"]["redirect_uri"] = url
    assert not auth_available(settings)

def test_web_preview_never_starts_login_to_a_pc_address():
    settings = config()
    settings["auth"]["redirect_uri"] = "http://localhost:5173/oauth2callback"
    assert "PC 내부 주소" in login_problem(settings, local_preview=True)
    assert not login_problem(config(), local_preview=True)
    assert login_problem({})
