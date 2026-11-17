"""검증된 Streamlit 사용자 정보에서 필요한 이메일과 소유자 해시만 만든다."""
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import math
import re
import time
from collections.abc import Mapping

LIFETIME = 30 * 86400

class PublicError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status

def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()

def iso(at: float | None = None) -> str:
    return datetime.fromtimestamp(time.time() if at is None else at, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

@dataclass(frozen=True)
class Identity:
    owner: str
    email: str
    expires: float

    @property
    def email_hash(self) -> str:
        return digest(self.email)

def verified_identity(claims: Mapping, logged_in: bool, *, now: float | None = None, started: float | None = None) -> Identity | None:
    # 이 함수의 claims는 브라우저의 메시지가 아닌 st.user에서만 전달한다.
    if not logged_in:
        return None
    now = time.time() if now is None else now
    subject, email = claims.get("sub"), claims.get("email")
    if claims.get("iss", "https://accounts.google.com") not in ("https://accounts.google.com", "accounts.google.com"):
        raise PublicError("Google 계정을 확인하지 못했어요. 다시 로그인해 주세요.", 401)
    if not isinstance(subject, str) or not subject or len(subject) > 255 or claims.get("email_verified") is not True:
        raise PublicError("Google에서 확인한 이메일로 다시 로그인해 주세요.", 401)
    if not isinstance(email, str) or len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+", email.strip()):
        raise PublicError("로그인한 이메일을 확인하지 못했어요. 다시 로그인해 주세요.", 401)
    issued = claims.get("iat", started if started is not None else now)
    if isinstance(issued, bool) or not isinstance(issued, (int, float)) or not math.isfinite(issued) or issued > now + 60:
        raise PublicError("로그인 시간을 확인하지 못했어요. 다시 로그인해 주세요.", 401)
    expires = min(float(issued), started if started is not None else now) + LIFETIME
    if expires <= now:
        raise PublicError("로그인 시간이 지났어요. Google로 다시 로그인해 주세요.", 401)
    return Identity(f"google:v1:{digest('https://accounts.google.com:' + subject)}", email.strip().lower(), expires)
