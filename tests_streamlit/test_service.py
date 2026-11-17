from dataclasses import replace
import json
import uuid
import httpx
import pytest
from ggsafe_streamlit.identity import PublicError, iso
from ggsafe_streamlit.service import Service, parse_email

CASES = [
    (200, {"breaches": [["예시 A", "예시 B"]]}, "breached", 2),
    (200, {"breaches": [" 예시 A ", "예시 A"]}, "breached", 1),
    (404, {"Error": "Not found"}, "not_found", 0),
    (200, {"Error": "Not found", "breaches": []}, "not_found", 0),
    (200, {"Error": "Not found", "breaches": ["예시 A"]}, "api_error", 0),
    (200, {"breaches": []}, "api_error", 0), (200, {"breaches": [[]]}, "api_error", 0),
    (200, {"breaches": [[""]]}, "api_error", 0), (200, {"breaches": [["예시 A", None]]}, "api_error", 0),
    (200, {"breaches": [123]}, "api_error", 0), (200, {"breaches": [{}]}, "api_error", 0),
    (200, {"breaches": [[["예시 A"]]]}, "api_error", 0), (200, {"breaches": "예시 A"}, "api_error", 0),
    (200, {}, "api_error", 0), (200, None, "api_error", 0), (200, "html", "api_error", 0),
    (404, {}, "api_error", 0), (302, {"breaches": ["예시 A"]}, "api_error", 0),
    (403, {"Error": "Not found"}, "api_error", 0), (429, None, "rate_limited", 0),
    (503, {"Error": "Not found"}, "service_error", 0),
]

@pytest.mark.parametrize("status,payload,expected,count", CASES)
def test_email_response_parity(status, payload, expected, count):
    value = parse_email(status, payload)
    assert value["status"] == expected and value["breach_count"] == count
    assert "email" not in value and value["cached"] is False

def request_id():
    return str(uuid.uuid4())

def entry(now, **changes):
    return dict(id=request_id(), status="found", count=12345, checked_at=iso(now)) | changes

def scan(identity, **changes):
    return dict(email=identity.email, consent=True, save_history=False, force_refresh=False) | changes

@pytest.mark.parametrize("action,data", [("history", {}), ("clear", {"confirm": True}), ("email", {}), ("password", {})])
def test_anonymous_and_expired_requests_are_blocked(service, identity, now, action, data):
    for account in (None, replace(identity, expires=now - 1)):
        with pytest.raises(PublicError) as error:
            service.execute(action, data, account, request_id())
        assert error.value.status == 401

def test_only_authenticated_email_is_accepted_and_consent_is_required(service, identity, other):
    for payload in (scan(identity, email=other.email), scan(identity, consent=False)):
        with pytest.raises(PublicError):
            service.execute("email", payload, identity, request_id())

def test_password_saves_metadata_only_and_retry_is_idempotent(service, store, identity, now):
    payload = entry(now)
    for _ in range(3):
        assert service.execute("password", payload, identity, request_id()) == {"history_saved": True}
    rows = store.history(identity.owner, now)
    assert len(rows) == 1 and rows[0]["breach_count"] == 12345
    assert set(rows[0]) == {"id", "scan_type", "status", "breach_count", "checked_at", "created_at", "cached"}
    assert "@" not in json.dumps(rows)

@pytest.mark.parametrize("changes", [
    {"password": "synthetic-only"}, {"hash": "A" * 40}, {"prefix": "ABCDE"}, {"email": "test@example.com"},
    {"count": -1}, {"count": True}, {"count": 1.5}, {"count": 9007199254740992},
    {"status": "error"}, {"status": "not_found", "count": 2}, {"status": "found", "count": 0},
    {"checked_at": "bad"}, {"checked_at": None}, {"id": "bad"}, {"id": str(uuid.uuid1())},
])
def test_password_rejects_unexpected_or_invalid_data(service, identity, now, changes):
    with pytest.raises(PublicError):
        service.execute("password", entry(now, **changes), identity, request_id())

def test_password_rejects_future_and_old_timestamps(service, identity, now):
    for when in (now + 61, now - 31 * 86400):
        with pytest.raises(PublicError):
            service.execute("password", entry(now, checked_at=iso(when)), identity, request_id())

def test_account_history_and_deletion_are_isolated(service, store, identity, other, now):
    for account in (identity, other):
        service.execute("password", entry(now), account, request_id())
    assert len(service.execute("history", {}, identity, request_id())["rows"]) == 1
    with pytest.raises(PublicError):
        service.execute("clear", {"confirm": False}, identity, request_id())
    service.execute("clear", {"confirm": True}, identity, request_id())
    assert store.history(identity.owner, now) == [] and len(store.history(other.owner, now)) == 1

def test_valid_email_cache_reused_but_force_refresh_queries_again(store, identity, now):
    calls = []
    service = Service(store, lambda email: (calls.append(email) or (404, {"Error": "Not found"})), lambda: now)
    first = service.execute("email", scan(identity, save_history=True), identity, request_id())
    second = service.execute("email", scan(identity), identity, request_id())
    third = service.execute("email", scan(identity, force_refresh=True), identity, request_id())
    assert first["history_saved"] and second["cached"] and not third["cached"]
    assert calls == [identity.email, identity.email]
    assert len(store.history(identity.owner, now)) == 1

@pytest.mark.parametrize("code,payload", [(503, {}), (200, {}), (302, {}), (429, {})])
def test_error_results_are_never_cached(store, identity, now, code, payload):
    service = Service(store, lambda email: (code, payload), lambda: now)
    service.execute("email", scan(identity), identity, request_id())
    assert store.cached(identity.email_hash, now) is None

def test_timeout_and_connection_errors_are_not_safe(store, identity, now):
    for exception in (httpx.ReadTimeout("synthetic"), httpx.ConnectError("synthetic")):
        def fail(email):
            raise exception
        service = Service(store, fail, lambda: now)
        value = service.execute("email", scan(identity), identity, request_id())
        assert value["status"] in ("timeout", "network_error")
        assert store.cached(identity.email_hash, now) is None

def test_rate_limit_is_atomic_and_stops_external_query_after_six(store, identity, now):
    calls = []
    service = Service(store, lambda email: (calls.append(email) or (503, {})), lambda: now)
    for _ in range(7):
        value = service.execute("email", scan(identity), identity, request_id())
    assert len(calls) == 6 and value["status"] == "rate_limited"

def test_inflight_lock_prevents_duplicate_external_queries(service, store, identity, now):
    assert store.acquire(identity.email_hash, "synthetic-lease", now)
    value = service.execute("email", scan(identity, save_history=True), identity, request_id())
    assert value["status"] == "in_progress" and not value["history_saved"]
    assert store.history(identity.owner, now) == []

def test_history_limit_and_retention(store, service, identity, now):
    for index in range(105):
        store.save(identity.owner, dict(id=request_id(), scan_type="password", status="not_found", breach_count=0, checked_at=iso(now)), now=now - index)
    store.save(identity.owner, dict(id=request_id(), scan_type="email", status="not_found", breach_count=0, checked_at=iso(now - 31 * 86400)), now=now - 31 * 86400)
    assert len(service.execute("history", {}, identity, request_id())["rows"]) == 100
    assert store.query("SELECT COUNT(*) AS n FROM ggsafe_history")[0]["n"] == 105

def test_password_save_error_is_distinct_and_retry_never_calls_external(store, identity, now, monkeypatch):
    service = Service(store, lambda email: pytest.fail("외부 재조회 금지"), lambda: now)
    original = store.save
    def fail(*args, **kwargs):
        raise OSError("synthetic-secret-must-not-leak")
    monkeypatch.setattr(store, "save", fail)
    payload = entry(now)
    with pytest.raises(PublicError) as error:
        service.execute("password", payload, identity, request_id())
    assert error.value.status == 503 and "synthetic-secret" not in str(error.value)
    monkeypatch.setattr(store, "save", original)
    assert service.execute("password", payload, identity, request_id())["history_saved"]

@pytest.mark.parametrize("action,payload", [("history", {"owner": "someone-else"}), ("clear", {"confirm": 1}), ("clear", {"confirm": True, "owner": "someone-else"}), ("unsupported", {}), ("history", [])])
def test_spoofed_owner_and_invalid_operations_are_rejected(service, identity, action, payload):
    with pytest.raises(PublicError):
        service.execute(action, payload, identity, request_id())

def test_email_save_retry_keeps_metadata_and_never_repeats_lookup(store, identity, other, now, monkeypatch):
    calls, pending = [], {}
    original = store.save
    def fail(*args, **kwargs):
        raise OSError("synthetic-private-connection-value")
    service = Service(store, lambda email: (calls.append(email) or (200, {"breaches": [["예시 서비스"]]})), lambda: now, pending_email=pending)
    monkeypatch.setattr(store, "save", fail)
    value = service.execute("email", scan(identity, save_history=True), identity, request_id())
    assert value["status"] == "breached" and not value["history_saved"]
    assert "@" not in json.dumps(pending) and "예시 서비스" not in json.dumps(pending, ensure_ascii=False)
    receipt = {"id": value["history_id"]}
    with pytest.raises(PublicError) as error:
        service.execute("email_save", receipt, identity, request_id())
    assert error.value.status == 503 and "synthetic-private" not in str(error.value)
    with pytest.raises(PublicError):
        service.execute("email_save", receipt, other, request_id())
    with pytest.raises(PublicError):
        service.execute("email_save", {**receipt, "breach_count": 999}, identity, request_id())
    monkeypatch.setattr(store, "save", original)
    # Streamlit의 다음 실행에서도 서버 쪽 대기 메타데이터로만 저장한다.
    resumed = Service(store, lambda email: pytest.fail("외부 재조회 금지"), lambda: now, pending_email=pending)
    for _ in range(2):
        assert resumed.execute("email_save", receipt, identity, request_id())["history_saved"]
    assert calls == [identity.email]
    rows = store.history(identity.owner, now)
    assert len(rows) == 1 and rows[0]["breach_count"] == 1
    service.execute("clear", {"confirm": True}, identity, request_id())
    with pytest.raises(PublicError):
        resumed.execute("email_save", receipt, identity, request_id())

def test_email_retry_expires_and_pending_results_are_bounded(store, identity, now):
    pending = {}
    service = Service(store, lambda email: (404, {"Error": "Not found"}), lambda: now, pending_email=pending)
    first = service.execute("email", scan(identity, save_history=True), identity, request_id())
    for _ in range(11):
        latest = service.execute("email", scan(identity, save_history=True), identity, request_id())
    assert len(pending) == 10 and first["history_id"] not in pending
    later = Service(store, clock=lambda: now + 1801, pending_email=pending)
    with pytest.raises(PublicError) as error:
        later.execute("email_save", {"id": latest["history_id"]}, identity, request_id())
    assert error.value.status == 410

@pytest.mark.parametrize("payload", [{}, {"id": "invalid"}, {"id": str(uuid.uuid4()), "owner": "other"}])
def test_email_retry_rejects_untrusted_receipts(service, identity, payload):
    with pytest.raises(PublicError):
        service.execute("email_save", payload, identity, request_id())
