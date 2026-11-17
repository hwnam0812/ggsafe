import time
import pytest
from ggsafe_streamlit.identity import verified_identity
from ggsafe_streamlit.service import Service
from ggsafe_streamlit.storage import Store

@pytest.fixture
def store(tmp_path):
    return Store(preview_path=str(tmp_path / "test.sqlite3")).prepare()

@pytest.fixture
def now():
    return time.time()

@pytest.fixture
def identity(now):
    return verified_identity(dict(sub="synthetic-account-a", email="synthetic-a@example.com", email_verified=True, iat=now), True, now=now)

@pytest.fixture
def other(now):
    return verified_identity(dict(sub="synthetic-account-b", email="synthetic-b@example.com", email_verified=True, iat=now), True, now=now)

@pytest.fixture
def service(store, now):
    return Service(store, lookup=lambda email: (404, {"Error": "Not found"}), clock=lambda: now)
