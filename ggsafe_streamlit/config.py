"""민감한 설정은 Streamlit Secrets 또는 명시적인 실행 환경에서만 읽는다."""
import os
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import urlparse

from .identity import PublicError

GOOGLE_METADATA = "https://accounts.google.com/.well-known/openid-configuration"

def login_problem(secrets, *, local_preview=False):
    if not auth_available(secrets):
        return "Google 로그인 연결을 준비 중이에요. 지금은 검사와 이력을 사용할 수 없어요."
    callback = urlparse(secrets["auth"]["redirect_uri"])
    if local_preview and callback.hostname in ("localhost", "127.0.0.1"):
        return "Streamlit용 로그인 주소가 아직 준비되지 않았어요. PC 내부 주소로 잘못 이동하지 않도록 로그인을 중지했어요."
    return ""

def auth_available(secrets):
    if not isinstance(secrets, Mapping):
        return False
    auth = secrets.get("auth", {})
    if not isinstance(auth, Mapping):
        return False
    google = auth.get("google", {})
    if not isinstance(google, Mapping) or not isinstance(google.get("client_kwargs", {}), Mapping):
        return False
    if not all(isinstance(value, str) for value in (auth.get("redirect_uri", ""), auth.get("cookie_secret", ""), google.get("client_id", ""), google.get("client_secret", ""))):
        return False
    try:
        callback = urlparse(auth.get("redirect_uri", ""))
        hostname = callback.hostname
        # 잘못된 포트가 있는 주소도 로그인 전에 거절한다.
        callback.port
    except ValueError:
        return False
    return bool(
        len(auth.get("cookie_secret", "")) >= 32
        and google.get("client_id") and google.get("client_secret")
        and google.get("server_metadata_url") == GOOGLE_METADATA
        and google.get("client_kwargs", {}).get("scope") == "openid email"
        and not auth.get("expose_tokens")
        and not google.get("expose_tokens")
        and callback.path == "/oauth2callback" and hostname
        and not callback.username and not callback.password and not callback.query and not callback.fragment
        and (callback.scheme == "https" or (callback.scheme == "http" and hostname in ("localhost", "127.0.0.1")))
    )

def storage_settings(secrets):
    storage = secrets.get("storage", {})
    if not isinstance(storage, Mapping):
        raise PublicError("검사 이력 보관 설정을 확인해 주세요.", 503)
    url = storage.get("database_url", "") or os.environ.get("GGSAFE_DATABASE_URL", "")
    if not isinstance(url, str):
        raise PublicError("검사 이력 보관 설정을 확인해 주세요.", 503)
    if url:
        return dict(database_url=url)
    # Community Cloud에서는 이 실행기를 쓰지 않으므로 조용히 임시 보관으로 전환하지 않는다.
    if os.environ.get("GGSAFE_LOCAL_PREVIEW") == "1":
        path = os.environ.get("GGSAFE_PREVIEW_DB", str(Path.home() / ".cache/ggsafe-streamlit/preview.sqlite3"))
        return dict(preview_path=path)
    raise PublicError("검사 이력을 오래 보관할 연결이 아직 준비되지 않았어요. 운영자에게 알려 주세요.", 503)
