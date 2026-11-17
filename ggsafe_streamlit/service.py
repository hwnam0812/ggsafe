"""외부 조회·이력 처리. 브라우저가 보낸 계정·이메일을 신원으로 신뢰하지 않는다."""
from datetime import datetime
import json
import logging
import time
import uuid
from urllib.parse import quote

import httpx

from .identity import Identity, PublicError, iso
from .storage import Store

def result(status, message, names=(), *, now=None):
    return dict(status=status, message=message, breaches=list(names), breach_count=len(names), source="XposedOrNot", checked_at=iso(now), cached=False)

def parse_email(status, payload, *, now=None):
    def make(code, message, names=()):
        return result(code, message, names, now=now)
    if status == 429:
        return make("rate_limited", "조회 서비스의 요청 한도에 도달했어요. 시간을 두고 다시 시도해 주세요.")
    if status >= 500:
        return make("service_error", "조회 서비스가 응답하지 않아요. 잠시 후 다시 시도해 주세요.")
    if status not in (200, 404):
        return make("api_error", "조회 서비스가 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.")
    if not isinstance(payload, dict):
        return make("api_error", "검사 응답 형식이 올바르지 않아요. 다시 시도해 주세요.")
    groups = payload.get("breaches")
    if payload.get("Error") == "Not found" and ("breaches" not in payload or groups == []):
        return make("not_found", "조회 가능한 공개 데이터에서 유출 기록을 찾지 못했어요.")
    if status != 200 or "Error" in payload or not isinstance(groups, list) or not groups:
        return make("api_error", "검사 응답이 비어 있거나 올바르지 않아요. 다시 시도해 주세요.")
    names = []
    for group in groups:
        values = group if isinstance(group, list) else [group]
        if not values or any(not isinstance(name, str) or not name.strip() for name in values):
            return make("api_error", "유출 서비스 목록을 확인하지 못했어요. 다시 시도해 주세요.")
        names.extend(name.strip() for name in values)
    return make("breached", "이메일과 관련된 공개 유출 기록이 발견됐어요.", list(dict.fromkeys(names)))

def lookup_email(email):
    # 공유 쿠키·인증정보·Google 토큰·이력 구분값을 외부 요청에 넣지 않는다.
    with httpx.Client(timeout=15, follow_redirects=False, trust_env=False) as client:
        with client.stream("GET", "https://api.xposedornot.com/v1/check-email/" + quote(email, safe=""), headers={"Accept": "application/json", "User-Agent": "GGSAFE/1.0"}) as response:
            content = bytearray()
            for chunk in response.iter_bytes():
                content.extend(chunk)
                if len(content) > 512 * 1024:
                    return response.status_code, None
            try:
                return response.status_code, json.loads(content)
            except (ValueError, UnicodeError):
                return response.status_code, None

def valid_uuid(value):
    try:
        return isinstance(value, str) and str(uuid.UUID(value, version=4)) == value.lower() and uuid.UUID(value).version == 4
    except (ValueError, AttributeError):
        return False

def password_entry(data, now):
    if set(data) != {"id", "status", "count", "checked_at"} or not valid_uuid(data.get("id")):
        raise PublicError("완료한 검사의 시각·결과·발견 횟수만 저장할 수 있어요.")
    count, status, checked = data["count"], data["status"], data["checked_at"]
    if type(count) is not int or count < 0 or count > 9007199254740991 or not ((status == "found" and count > 0) or (status == "not_found" and count == 0)):
        raise PublicError("검사 결과와 발견 횟수를 확인해 주세요.")
    try:
        parsed = datetime.fromisoformat(checked.replace("Z", "+00:00")).timestamp()
        if iso(parsed) != checked or not now - 30 * 86400 <= parsed <= now + 60:
            raise ValueError()
    except (ValueError, TypeError, AttributeError, OverflowError):
        raise PublicError("완료한 검사 시각을 확인해 주세요.") from None
    return dict(id=data["id"].lower(), scan_type="password", status="breached" if status == "found" else "not_found", breach_count=count, checked_at=checked)

class Service:
    def __init__(self, store: Store, lookup=lookup_email, clock=time.time, *, pending_email=None):
        self.store, self.lookup, self.clock = store, lookup, clock
        # 현재 로그인 연결에서 확인한 메타데이터만 보관한다. 이메일·서비스 목록은 넣지 않는다.
        self.pending_email = pending_email if pending_email is not None else {}

    def execute(self, action, data, identity: Identity | None, request_id):
        now = self.clock()
        if identity is None or identity.expires <= now:
            raise PublicError("Google로 로그인한 후 이용해 주세요.", 401)
        if not isinstance(data, dict):
            raise PublicError("요청 내용을 확인해 주세요.")
        if action == "history":
            if data:
                raise PublicError("이력 조회 요청을 확인해 주세요.")
            self.cleanup(now)
            return {"rows": self.store.history(identity.owner, now)}
        if action == "clear":
            if set(data) != {"confirm"} or data.get("confirm") is not True:
                raise PublicError("삭제 여부를 먼저 선택해 주세요.")
            self.store.clear(identity.owner)
            for key in list(self.pending_email):
                if self.pending_email[key]["owner"] == identity.owner:
                    self.pending_email.pop(key)
            return {"ok": True}
        if action == "password":
            entry = password_entry(data, now)
            self.cleanup(now)
            try:
                self.store.save(identity.owner, entry, now=now)
            except Exception:
                raise PublicError("검사는 완료했지만 이력은 저장하지 못했어요. 이력 저장을 다시 시도해 주세요.", 503) from None
            return {"history_saved": True}
        if action == "email":
            return self.scan(data, identity, request_id, now)
        if action == "email_save":
            if set(data) != {"id"} or not valid_uuid(data.get("id")):
                raise PublicError("저장할 이메일 검사 결과를 확인해 주세요.")
            pending = self.pending_email.get(data["id"])
            if not pending or pending["owner"] != identity.owner or pending["expires"] <= now:
                raise PublicError("이 결과의 저장 대기 시간이 지났어요. 이메일을 다시 검사해 주세요.", 410)
            try:
                self.store.save(identity.owner, pending["entry"], now=now)
            except Exception:
                raise PublicError("검사 결과는 유지하고 있어요. 이력 보관 연결을 확인한 뒤 저장만 다시 시도해 주세요.", 503) from None
            return {"history_saved": True}
        raise PublicError("지원하지 않는 검사 요청이에요.")

    def cleanup(self, now):
        try:
            self.store.cleanup(now)
        except Exception:
            logging.warning("ggsafe_cleanup_failed")

    def scan(self, data, identity, request_id, now):
        if set(data) != {"email", "consent", "save_history", "force_refresh"} or data.get("consent") is not True:
            raise PublicError("이메일 외부 전송에 동의한 후 검사해 주세요.")
        if not isinstance(data["email"], str) or data["email"].strip().lower() != identity.email:
            raise PublicError("로그인한 Google 이메일만 검사할 수 있어요.", 403)
        if type(data["save_history"]) is not bool or type(data["force_refresh"]) is not bool:
            raise PublicError("검사 설정을 확인해 주세요.")
        for key in list(self.pending_email):
            if self.pending_email[key]["expires"] <= now:
                self.pending_email.pop(key)
        self.cleanup(now)
        def finish(scan):
            scan = {**scan, "history_requested": data["save_history"], "history_saved": False}
            if data["save_history"] and scan["status"] != "in_progress":
                entry = dict(id=request_id, scan_type="email", status=scan["status"], breach_count=scan["breach_count"], checked_at=scan["checked_at"], cached=scan["cached"])
                self.pending_email[request_id] = {"owner": identity.owner, "entry": entry, "expires": self.clock() + 1800}
                while len(self.pending_email) > 10:
                    self.pending_email.pop(next(iter(self.pending_email)))
                scan["history_id"] = request_id
                try:
                    self.store.save(identity.owner, entry, now=self.clock())
                    scan["history_saved"] = True
                except Exception:
                    logging.warning("ggsafe_email_history_save_failed")
            return scan
        if not data["force_refresh"]:
            cached = self.store.cached(identity.email_hash, now)
            if cached:
                return finish({**cached, "cached": True})
        if self.store.rate(identity.owner, now) > 6:
            return finish(result("rate_limited", "검사 요청이 많아요. 1분 후 다시 시도해 주세요.", now=now))
        token = str(uuid.uuid4())
        if not self.store.acquire(identity.email_hash, token, now):
            return finish(result("in_progress", "같은 이메일의 검사가 이미 진행 중이에요. 잠시 후 다시 확인해 주세요.", now=now))
        try:
            if data["force_refresh"]:
                self.store.uncache(identity.email_hash)
            try:
                status, payload = self.lookup(identity.email)
                scan = parse_email(status, payload, now=self.clock())
            except httpx.TimeoutException:
                scan = result("timeout", "조회 시간이 길어 검사를 멈췄어요. 잠시 후 다시 검사해 주세요.", now=self.clock())
            except Exception:
                scan = result("network_error", "검사를 완료하지 못했어요. 연결 상태를 확인하고 잠시 후 다시 시도해 주세요.", now=self.clock())
            if scan["status"] in ("breached", "not_found"):
                try:
                    self.store.cache(identity.email_hash, scan, self.clock())
                except Exception:
                    logging.warning("ggsafe_cache_save_failed")
            return finish(scan)
        finally:
            try:
                self.store.release(identity.email_hash, token)
            except Exception:
                logging.warning("ggsafe_lease_release_failed")
