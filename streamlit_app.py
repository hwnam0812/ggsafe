"""Streamlit Community Cloud entry point. Browser UI never supplies an identity."""
from collections import OrderedDict
import json
import logging
import os
from pathlib import Path
import time
import traceback
import uuid

import streamlit as st
import streamlit.components.v1 as components

from ggsafe_streamlit.config import auth_available, login_problem, storage_settings
from ggsafe_streamlit.identity import PublicError, iso, verified_identity
from ggsafe_streamlit import service as service_module
from ggsafe_streamlit.storage import Store

st.set_page_config(page_title="GGSAFE · 내 계정을 위한 안전한 습관", page_icon="🛡️", layout="wide", initial_sidebar_state="collapsed")

# 검증된 앱 UI만 iframe으로 제공한다. 입력한 비밀번호는 React 상태 안에만 있다.
st.html("""<style>
html,body,[data-testid="stAppViewContainer"]{background:#f5f7fb}
[data-testid="stHeader"]{display:none}
[data-testid="stMainBlockContainer"]{padding:0!important;max-width:none!important}
[data-testid="stVerticalBlock"]{gap:0!important}
[data-testid="stCustomComponentV1"]{width:100%}
iframe[title$=".ui"]{display:block;border:0;width:100%}
</style>""")

@st.cache_resource(show_spinner=False)
def create_store(**settings):
    return Store(**settings).prepare()

try:
    secrets = st.secrets.to_dict()
except (FileNotFoundError, st.errors.StreamlitSecretNotFoundError):
    secrets = {}

configured = auth_available(secrets)
local_preview = os.environ.get("GGSAFE_LOCAL_PREVIEW") == "1"
if local_preview:
    # 장시간 켜 둔 개발 미리보기에서도 Python이 이전 검사 모듈을 재사용하지 않게 한다.
    # 게시 앱에서는 Streamlit의 정상 로딩을 그대로 사용한다.
    import importlib
    importlib.reload(service_module)
valid_uuid = service_module.valid_uuid
setup_error = login_problem(secrets, local_preview=local_preview)
available = configured and not setup_error
state = st.session_state
state.setdefault("_started", time.time())
identity = None
try:
    if configured:
        identity = verified_identity(dict(st.user), st.user.is_logged_in, started=state["_started"])
        if identity:
            setup_error = ""
except PublicError as error:
    setup_error = str(error)

owner = identity.owner if identity else None
if state.get("_owner") != owner or "_connection" not in state:
    state["_owner"] = owner
    state["_connection"] = str(uuid.uuid4())
    state["_replies"] = OrderedDict()
    state["_reply"] = None
    state["_email_pending"] = {}

store = None
storage_error = ""
if identity:
    try:
        store = create_store(**storage_settings(secrets))
    except PublicError as error:
        storage_error = str(error)
    except Exception:
        storage_error = "검사 이력 보관에 연결하지 못했어요. 연결 설정과 사용 가능 상태를 확인한 뒤 다시 시도해 주세요."

snapshot = dict(
    available=available, user={"email": identity.email} if identity else None,
    connection_id=state["_connection"], expires_at=iso(identity.expires) if identity else None,
    error=setup_error, storage_ready=store is not None,
    storage_error=storage_error,
    local_preview=local_preview,
)

ui = components.declare_component("ui", path=str(Path(__file__).parent / "ggsafe_streamlit/ui"))
request = ui(session=snapshot, reply=state.get("_reply"), default=None, key="ggsafe_ui")

if isinstance(request, dict):
    request_id = request.get("id")
    if valid_uuid(request_id) and request_id not in state["_replies"]:
        action, data = request.get("action"), request.get("data", {})
        try:
            if set(request) != {"id", "connection", "action", "data"} or len(json.dumps(request, ensure_ascii=False)) > 4096:
                raise PublicError("요청 내용을 확인해 주세요.")
            if action in ("login", "switch"):
                if not available:
                    raise PublicError(setup_error, 503)
                st.login("google")
                st.stop()
            if action == "logout":
                if configured:
                    st.logout()
                    st.stop()
                value = {"ok": True}
            elif request.get("connection") != state["_connection"]:
                raise PublicError("계정이 바뀌었어요. 현재 계정에서 다시 시도해 주세요.", 401)
            elif action == "session":
                if identity is None:
                    raise PublicError("Google로 로그인한 후 이용해 주세요.", 401)
                value = {"active": True}
            elif action == "storage":
                if identity is None:
                    raise PublicError("Google로 로그인한 후 이용해 주세요.", 401)
                if store is None:
                    raise PublicError(storage_error, 503)
                value = {"ready": True}
            else:
                if identity is None:
                    raise PublicError("Google로 로그인한 후 이용해 주세요.", 401)
                if store is None:
                    raise PublicError(storage_error, 503)
                service = service_module.Service(store, pending_email=state.setdefault("_email_pending", {}))
                value = service.execute(action, data, identity, request_id)
            reply = {"id": request_id, "ok": True, "value": value}
        except PublicError as error:
            reply = {"id": request_id, "ok": False, "error": str(error), "status": error.status}
        except Exception as error:
            # 외부 오류 원문·계정·설정값을 화면이나 로그에 남기지 않는다.
            logging.warning("ggsafe_request_failed:%s", type(error).__name__)
            logging.warning("ggsafe_request_location:%s", ",".join(f"{Path(frame.filename).name}:{frame.lineno}" for frame in traceback.extract_tb(error.__traceback__)))
            reply = {"id": request_id, "ok": False, "error": "요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.", "status": 503}
        state["_replies"][request_id] = reply
        while len(state["_replies"]) > 64:
            state["_replies"].popitem(last=False)
        state["_reply"] = reply
        st.rerun()
    elif valid_uuid(request_id) and (state.get("_reply") or {}).get("id") != request_id:
        state["_reply"] = state["_replies"][request_id]
        st.rerun()
