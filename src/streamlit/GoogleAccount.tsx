import { useState } from "react";
import { Check, LoaderCircle, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import Modal from "../security/Modal";
import { useGoogle } from "./GoogleProvider";

export default function GoogleAccount() {
  const { state: { session, loading, operation, error }, actions: { login, logout } } = useGoogle();
  const [open, setOpen] = useState(false);
  const busy = loading || operation !== "idle";
  return <>
    <button type="button" className="gg-google-button" onClick={() => session.user ? setOpen(true) : void login()} disabled={busy || (!session.user && !session.available)} aria-haspopup={session.user ? "dialog" : undefined}>
      {busy ? <LoaderCircle size={17} className="gg-spinning" aria-hidden="true"/> : session.user ? <ShieldCheck size={17} aria-hidden="true"/> : <span className="gg-google-letter" aria-hidden="true">G</span>}
      <span>{busy ? "연결 확인 중…" : session.user ? "Google 계정 연결됨" : "Google로 로그인"}</span>
    </button>
    <Modal title="Google 계정 연결" open={open} onClose={() => setOpen(false)}>
      {session.user && <>
        <div className="gg-account-identity"><div><Check size={23} aria-hidden="true"/></div><span>Google에서 확인한 이메일</span><strong>{session.user.email}</strong></div>
        <p>로그인한 이메일만 검사할 수 있어요. 외부 전송에 동의하고 검사 버튼을 눌러야 실제 조회해요.</p>
        <p>로그아웃하지 않으면 최대 30일 동안 로그인을 유지해요. 브라우저의 쿠키 차단·삭제 설정에 따라 다시 로그인해야 할 수 있어요.</p>
        <p>검사 이력은 내 Google 계정에만 보관해요. 같은 계정으로 로그인하면 다른 브라우저에서도 볼 수 있어요.</p>
        <div className="gg-google-account-actions"><button type="button" className="gg-secondary-button" disabled={busy || !session.available} onClick={() => void login(true)}><RefreshCw size={16} aria-hidden="true"/>다른 계정으로 연결</button><button type="button" className="gg-secondary-button" disabled={busy} onClick={() => void logout()}><LogOut size={16} aria-hidden="true"/>로그아웃</button></div>
        <p className="gg-google-small-note">로그아웃하면 입력과 현재 결과는 지우고, 저장한 이력은 유지해요. Google 자체에서 로그아웃되는 것은 아니에요.</p>
      </>}
      {error && <p className="gg-form-error" role="alert">{error}</p>}
    </Modal>
  </>;
}
