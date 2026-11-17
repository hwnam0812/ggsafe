"""로컬 E2E 전용. 합성 신원으로 Streamlit의 실제 쿠키·화면·보관 흐름을 검사한다.

앱에서 import하거나 HTTP로 노출하지 않는다. 키·쿠키는 파일이나 보고서에 출력하지 않는다.
테스트 드라이버는 이 프로세스의 표준 출력을 메모리에서만 읽는다.
"""
import hashlib
import json
from pathlib import Path
import sys
import time

from streamlit.web.server.starlette.starlette_app_utils import create_signed_value
from ggsafe_streamlit.identity import digest, verified_identity, iso
from ggsafe_streamlit.storage import Store

def main():
    data = json.load(sys.stdin)
    subject = data["subject"]
    if not subject.startswith("synthetic-streamlit-"):
        raise ValueError("합성 계정만 사용할 수 있어요.")
    project = hashlib.sha256(str(Path.cwd()).encode()).hexdigest()[:16]
    cache = Path.home() / ".cache/ggsafe-streamlit" / project
    now = time.time()
    email = f"{subject}@example.com"
    issued = data.get("issued", now)
    claims = dict(iss="https://accounts.google.com", sub=subject, email=email, email_verified=True, iat=issued)
    # 만료 쿠키의 차단도 확인하므로 소유자 키 자체는 현재 시각 기준으로 계산한다.
    owner = verified_identity({**claims, "iat": now}, True, now=now).owner
    action = data["action"]
    if action == "identity":
        value = json.dumps({**claims, "origin": "http://localhost:5173", "is_logged_in": True})
        signed = create_signed_value((cache / "cookie-key").read_text(), "_streamlit_user", value).decode()
        return dict(cookie=signed, email=email, owner=owner)
    store = Store(preview_path=str(cache / "preview.sqlite3")).prepare()
    if action == "seed":
        names = [f"합성 예시 서비스 {index + 1}" for index in range(data.get("count", 0))]
        value = dict(status="breached" if names else "not_found", message="합성 테스트 응답이에요.", breach_count=len(names), breaches=names, source="합성 테스트", checked_at=iso(now), cached=False)
        store.cache(digest(email), value, now)
        return {"ok": True}
    if action == "rows":
        return store.history(owner, now)
    if action == "cleanup":
        store.clear(owner)
        store.uncache(digest(email))
        store.query("DELETE FROM ggsafe_rate WHERE rate_key LIKE ?", (owner + ":%",))
        store.query("DELETE FROM ggsafe_leases WHERE email_hash = ?", (digest(email),))
        return {"ok": True}
    raise ValueError("지원하지 않는 합성 테스트 요청이에요.")

if __name__ == "__main__":
    print(json.dumps(main(), ensure_ascii=False))
