import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, LoaderCircle, LogOut, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import Modal from "./Modal";
import { useGoogle } from "./GoogleProvider";

// 사용자가 알려준 PC 앱용 주소입니다. 현재 웹 로그인 주소로 대체하지 않습니다.
const providedPcCallback = "http://localhost:8501/oauth2callback";

function GoogleIdentityButton() {
  const element = useRef<HTMLDivElement>(null);
  const { state: { buttonReady, operation, error }, actions: { mountButton } } = useGoogle();
  useEffect(() => {
    if (element.current) return mountButton(element.current);
  }, [mountButton]);
  return <div className="gg-google-identity" hidden={!!error}>
    {!buttonReady && !error && operation === "idle" && <p role="status">Google 로그인 버튼을 준비하고 있어요…</p>}
    <div ref={element} inert={!buttonReady || operation !== "idle"} aria-label="Google 공식 로그인 버튼"/>
  </div>;
}

export default function GoogleAccount() {
  const { state: { session, loading, operation, error }, actions: { cancel, logout, refresh }, meta: { javascriptOrigin } } = useGoogle();
  const busy = operation !== "idle";
  const scanning = false;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [changing, setChanging] = useState(false);
  const [attempt, setAttempt] = useState(0);
  async function copyUri() {
    try { await navigator.clipboard.writeText(javascriptOrigin); setCopied(true); setCopyError(""); }
    catch { setCopyError("자동으로 복사하지 못했어요. 주소를 길게 누르거나 선택해 복사해 주세요."); }
  }
  return <>
    <button type="button" className="gg-google-button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
      {busy || loading ? <LoaderCircle size={17} className="gg-spinning" aria-hidden="true"/> : session.user ? <ShieldCheck size={17} className="gg-google-connected-icon" aria-hidden="true"/> : <span className="gg-google-letter" aria-hidden="true">G</span>}
      <span aria-live="polite">{loading ? "연결 확인 중…" : operation === "logout" ? "연결 해제 중…" : busy ? "Google 연결 중…" : session.user ? "Google 계정 연결됨" : "Google로 로그인"}</span>
    </button>
    <Modal title="Google 계정 연결" open={open} onClose={() => setOpen(false)}>
      <div className="gg-google-preview-note"><ShieldCheck size={17} aria-hidden="true"/><span>미리보기 전용 연결이에요.</span></div>
      {session.user ? <>
        <div className="gg-account-identity"><div><Check size={23} aria-hidden="true"/></div><span>Google에서 확인한 이메일</span><strong>{session.user.email}</strong></div>
        <p>로그인한 이메일만 검사할 수 있어요. 외부 전송에 동의하고 검사 버튼을 눌러야 실제 조회해요.</p>
        <p>마지막 이용으로부터 3일 동안 로그인을 유지해요. 그 전에 다시 이용하면 3일로 연장돼요. 탭을 켜두기만 해서는 연장되지 않아요.</p>
        <p>검사 이력은 이 Google 계정에만 보관해요. 같은 계정으로 로그인하면 다른 브라우저에서도 볼 수 있어요.</p>
        <div className="gg-google-account-actions"><button type="button" className="gg-secondary-button" onClick={() => { setChanging(true); setAttempt(value => value + 1); }} disabled={busy}><RefreshCw size={16} aria-hidden="true"/>다른 계정으로 연결</button><button type="button" className="gg-secondary-button" onClick={() => void logout()} disabled={busy}><LogOut size={16} aria-hidden="true"/>로그아웃</button></div>
        <p className="gg-google-small-note">연결을 해제하면 입력과 현재 검사 결과를 지워요. 저장한 이력은 그대로 두며, Google 자체에서 로그아웃되는 것은 아니에요.</p>
      </> : <>
        <h3 className="gg-google-intro-title">내 Google 이메일로 시작해요.</h3>
        <p>Google에서 확인한 계정으로 로그인해요. 내 이메일만 검사하고, 내 계정의 이력만 볼 수 있어요. 이름·사진·비밀번호·메일함·기기 목록은 가져오지 않아요.</p>
        <p className="gg-google-redirect-notice"><strong>Google 공식 창에서 계정을 선택해 주세요.</strong> 웹 주소를 이미 등록했다면 다시 추가할 필요 없어요. 주소 관련 오류가 나올 때만 아래 설정을 확인해 주세요.</p>
      </>}
      {error && <p className="gg-form-error" role="alert">{error}</p>}
      {open && !loading && session.available && !scanning && (!session.user || changing) && <GoogleIdentityButton key={attempt}/>}
      {operation === "login" && <div className="gg-google-waiting" role="status"><LoaderCircle size={19} className="gg-spinning" aria-hidden="true"/><p>Google 창에서 계정을 선택해 주세요.<br/>창이 열리지 않으면 이 사이트의 팝업을 허용해 주세요. 창을 닫았다면 대기를 취소한 뒤 다시 준비할 수 있어요.</p><button type="button" onClick={cancel} className="gg-secondary-button">로그인 대기 취소</button></div>}
      {operation === "logout" && <p role="status">GGSAFE 연결을 해제하고 있어요…</p>}
      {error && !busy && session.available && (!session.user || changing) && <button type="button" className="gg-secondary-button gg-google-continue" onClick={() => setAttempt(value => value + 1)} disabled={loading || scanning}><RefreshCw size={16} aria-hidden="true"/>로그인 버튼 다시 준비</button>}
      {!loading && !session.available && <div className="gg-notice">지금은 Google 연결 설정을 사용할 수 없어요. 이 연결은 미리보기에서만 지원하며 공개 앱의 방문자별 로그인은 지원하지 않아요.<button type="button" onClick={() => void refresh()} className="gg-text-button">연결 설정 다시 확인</button></div>}
      {scanning && <p className="gg-field-help">이메일 검사가 끝난 뒤 계정을 연결하거나 변경해 주세요.</p>}
      <details className="gg-google-setup">
        <summary>Google 설정 · 웹 주소 등록</summary>
        <div>
          <p>Google Cloud 콘솔에서 기존 웹 클라이언트를 열고 <strong>승인된 JavaScript 원본</strong>에 아래 주소를 추가한 뒤 저장해 주세요. 끝에 경로나 슬래시를 붙이지 않아요.</p>
          <label htmlFor="google-javascript-origin">Google에 등록할 웹 주소</label>
          <div className="gg-copy-uri"><input id="google-javascript-origin" name="google_javascript_origin" type="url" autoComplete="off" value={javascriptOrigin} readOnly onFocus={event => event.target.select()} spellCheck={false}/><button type="button" aria-label="Google에 등록할 웹 주소 복사" onClick={() => void copyUri()}>{copied ? <Check size={17} aria-hidden="true"/> : <Copy size={17} aria-hidden="true"/>}</button></div>
          <p className="gg-copy-feedback" role="status">{copyError || (copied ? "주소를 복사했어요." : "미리보기 주소가 바뀌면 새 주소도 추가해야 해요.")}</p>
          <p>기존 PC용·웹용 ‘승인된 리디렉션 URI’는 지우지 않아도 돼요. 이 로그인은 Google 창에서 현재 화면으로 결과를 전달하므로 미리보기 주소를 새 창에서 열지 않아요. 미리보기 접근 제한도 그대로 유지해요.</p>
          <p className="gg-google-local-address"><strong>알려주신 PC 앱용 주소 · 그대로 유지해요</strong><span translate="no">{providedPcCallback}</span></p>
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Google Cloud 설정 열기<ExternalLink size={13} aria-hidden="true"/></a>
          <a href="https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid" target="_blank" rel="noopener noreferrer">웹 주소 등록 안내 · Google 공식 문서<ExternalLink size={13} aria-hidden="true"/></a>
        </div>
      </details>
      <p className="gg-google-small-note"><Mail size={13} aria-hidden="true"/>로그인 이메일만 검사해요. 다른 주소를 입력하는 기능은 제공하지 않아요.</p>
    </Modal>
  </>;
}
