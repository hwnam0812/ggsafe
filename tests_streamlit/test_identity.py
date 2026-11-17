import pytest
from ggsafe_streamlit.identity import LIFETIME, PublicError, verified_identity

def claims(now):
    return dict(sub="synthetic-sub", email="SYNTHETIC@EXAMPLE.COM", email_verified=True, iat=now)

def test_identity_comes_from_verified_claims_and_uses_thirty_days(now):
    identity = verified_identity(claims(now), True, now=now)
    assert identity.email == "synthetic@example.com"
    assert identity.expires == now + LIFETIME
    assert identity.owner.startswith("google:v1:") and "synthetic" not in identity.owner

def test_no_identity_before_native_login(now):
    assert verified_identity(claims(now), False, now=now) is None

@pytest.mark.parametrize("field,value", [
    ("sub", ""), ("sub", None), ("sub", "x" * 256),
    ("email_verified", False), ("email_verified", "true"), ("email_verified", 1),
    ("email", "bad"), ("email", None), ("email", "a@b"),
    ("iss", "https://not-google.example"), ("iat", True), ("iat", "123"), ("iat", float("nan")),
])
def test_invalid_claims_fail_closed(field, value, now):
    value_claims = claims(now); value_claims[field] = value
    with pytest.raises(PublicError):
        verified_identity(value_claims, True, now=now)

def test_expired_and_future_issued_times_are_blocked(now):
    for issued in (now - LIFETIME, now + 61):
        with pytest.raises(PublicError):
            verified_identity({**claims(now), "iat": issued}, True, now=now)

def test_automatic_checks_do_not_extend_expiration(now):
    before = verified_identity(claims(now), True, now=now)
    after = verified_identity(claims(now), True, now=now + 86400)
    assert before.expires == after.expires

def test_same_subject_different_browser_same_owner_but_not_email_based(now):
    first = verified_identity(claims(now), True, now=now)
    renamed = verified_identity({**claims(now), "email": "renamed@example.com"}, True, now=now)
    different = verified_identity({**claims(now), "sub": "another-account"}, True, now=now)
    assert first.owner == renamed.owner and first.owner != different.owner
