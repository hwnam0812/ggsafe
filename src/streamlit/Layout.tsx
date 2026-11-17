import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { BookOpen, ChevronRight, CircleHelp, History, LayoutDashboard, LockKeyhole, ScanLine, Shield, ShieldCheck } from "lucide-react";
import { SecurityProvider } from "../security/SecurityProvider";
import Modal from "../security/Modal";
import GoogleAccount from "./GoogleAccount";
import { GoogleProvider, useGoogle } from "./GoogleProvider";
import { nativeRequest } from "./bridge";

const navigation = [
  { to: "/", title: "대시보드", icon: LayoutDashboard }, { to: "/scan", title: "보안 검사", icon: ScanLine },
  { to: "/guide", title: "해결 가이드", icon: BookOpen }, { to: "/history", title: "검사 이력", icon: History }
];
export default function Layout() { return <GoogleProvider><ConnectedWorkspace/></GoogleProvider>; }
function ConnectedWorkspace() {
  const { state: { session, loading, operation, error }, actions: { refresh } } = useGoogle();
  if (loading || operation !== "idle") return <div className="gg-login-page"><main className="gg-login-card" aria-busy="true"><ShieldCheck size={42} aria-hidden="true"/><h1>{operation === "logout" ? "로그아웃하고 있어요…" : operation === "login" ? "Google로 이동하고 있어요…" : "로그인을 확인하고 있어요…"}</h1><p role="status">내 계정의 기록을 안전하게 준비해요.</p>{error && <p className="gg-form-error" role="alert">{error}</p>}</main></div>;
  if (!session.user) return <div className="gg-login-page"><main className="gg-login-card"><a href="#login-start" className="gg-login-brand"><Shield size={30} aria-hidden="true"/><span translate="no">GGSAFE</span></a><div className="gg-login-symbol"><LockKeyhole size={38} aria-hidden="true"/></div><h1>내 계정으로<br/>안전하게 시작해요.</h1><p>Google로 로그인하면 내 이메일을 검사하고,<br/>내 계정의 검사 이력을 확인할 수 있어요.</p><div id="login-start"><GoogleAccount/></div>{error && <div className="gg-login-error"><p className="gg-form-error" role="alert">{error}</p>{session.available ? <button type="button" className="gg-text-button" onClick={() => void refresh()}>로그인 상태 다시 확인</button> : <p className="gg-login-setup-note">기존 PC·웹 로그인 등록은 그대로 유지해요. Streamlit 공개 주소가 정해지면 그 주소에 맞는 로그인 연결이 필요해요.</p>}</div>}<div className="gg-login-details"><strong>최대 30일 동안 로그인 유지</strong><p>로그아웃하거나 로그인 쿠키를 지우면 다시 로그인해요.<br/>Google 비밀번호는 가져오지 않아요.</p></div><small>검사는 로그인 후 별도 동의와 버튼 클릭으로 시작해요.</small></main></div>;
  return <SecurityProvider key={session.connection_id} email={session.user.email}><SecurityShell/></SecurityProvider>;
}
function SecurityShell() {
  const [privacy, setPrivacy] = useState(false);
  const [checkingStorage, setCheckingStorage] = useState(false);
  const { pathname } = useLocation();
  const { state: { session, error } } = useGoogle();
  const current = navigation.find(item => item.to === pathname)?.title ?? "대시보드";
  return <div className="gg-app"><a href="#main-content" className="gg-skip">본문 바로가기</a>
    <aside className="gg-sidebar"><NavLink to="/" className="gg-brand" aria-label="GGSAFE 대시보드"><Shield size={32} strokeWidth={2.3} aria-hidden="true"/><span translate="no">GGSAFE<span className="gg-brand-dot">.</span></span></NavLink><p className="gg-brand-caption">나의 계정을 위한 안전한 습관</p>
      <nav className="gg-navigation" aria-label="주 메뉴">{navigation.map(({ to, title, icon: Icon }) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `gg-nav-item ${isActive ? "is-active" : ""}`}><Icon size={19} aria-hidden="true"/><span>{title}</span><ChevronRight size={15} className="gg-nav-chevron" aria-hidden="true"/></NavLink>)}</nav>
      <div className="gg-sidebar-bottom"><div className="gg-privacy-note"><LockKeyhole size={22} aria-hidden="true"/><strong>개인정보는 최소한으로</strong><p>Google 비밀번호와 이메일 원문을 검사 이력에 저장하지 않아요.</p><button type="button" onClick={() => setPrivacy(true)}>개인정보 처리 안내 <ChevronRight size={13} aria-hidden="true"/></button></div><span className="gg-version">GGSAFE · Streamlit</span></div>
    </aside>
    <div className="gg-workspace"><header className="gg-topbar"><NavLink to="/" className="gg-mobile-brand" aria-label="GGSAFE 대시보드"><Shield size={25} aria-hidden="true"/><span translate="no">GGSAFE</span></NavLink><div className="gg-breadcrumb">내 보안 공간 <ChevronRight size={13} aria-hidden="true"/><span>{current}</span></div><div className="gg-topbar-actions"><button type="button" className="gg-icon-button" onClick={() => setPrivacy(true)} aria-label="개인정보 처리 안내"><CircleHelp size={20} aria-hidden="true"/></button><GoogleAccount/></div></header>
      <nav className="gg-mobile-nav" aria-label="모바일 주 메뉴">{navigation.map(({ to, title, icon: Icon }) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => isActive ? "is-active" : ""}><Icon size={17} aria-hidden="true"/><span>{title}</span></NavLink>)}</nav>
      <main id="main-content" className="gg-main">{error && <p className="gg-notice" role="alert">{error}</p>}{!session.storage_ready && <section className="gg-storage-notice" aria-labelledby="storage-notice-title"><h2 id="storage-notice-title">검사 이력 보관 연결이 필요해요</h2><p role="alert">{session.storage_error || "이력 보관에 연결하지 못했어요."}</p><p>연결되기 전에는 검사와 이력 저장을 시작할 수 없어요. 사라지는 임시 기록으로 대신 저장하지 않아요.</p><button type="button" className="gg-secondary-button" disabled={checkingStorage} onClick={async () => { setCheckingStorage(true); try { await nativeRequest("storage"); } catch { /* 새 연결 안내는 Streamlit의 검증한 상태로 갱신된다. */ } finally { setCheckingStorage(false); } }}>{checkingStorage ? "연결 확인 중…" : "보관 연결 다시 확인"}</button></section>}<Outlet/></main>
      <footer className="gg-footer"><ShieldCheck size={16} aria-hidden="true"/><span>확인한 정보만 표시해요. 유출 기록 미발견이 계정의 안전을 보장하지는 않아요.</span><button type="button" onClick={() => setPrivacy(true)}>개인정보 안내</button></footer>
    </div>
    <Modal title="개인정보 처리 안내" open={privacy} onClose={() => setPrivacy(false)}>
      <p>Google 공식 로그인으로 확인한 이메일만 검사해요. Google 비밀번호·메일함·기기 목록은 가져오지 않으며 Drive 권한은 요청하지 않아요. 앱은 이름·사진과 Google 로그인 토큰을 별도로 보관하지 않아요.</p>
      <p>Streamlit의 로그인 쿠키로 최대 30일 동안 로그인을 유지해요. 이 쿠키에는 Google에서 확인한 기본 계정 정보가 포함돼요. 로그아웃하면 현재 브라우저의 연결을 종료하고 입력·현재 결과를 지워요. 다른 브라우저의 로그인과 저장한 기록은 유지해요.</p>
      <p>이메일 외부 전송 동의와 검사 버튼 클릭이 있을 때만 XposedOrNot에 로그인 이메일을 보내요. 정상 응답은 이메일의 변환값으로 구분해 5분간 재사용하고 오류는 재사용하지 않아요. 선택한 이메일 이력에는 시각·결과·발견 수만 남겨요.</p>
      <p>비밀번호 검사는 별도 동의 후 기기에서 만든 변환값의 앞 5글자만 HIBP Pwned Passwords로 전송해요. 비밀번호 원문·전체 변환값·이메일·Google 정보를 보내지 않아요. 외부 서비스에는 접속에 필요한 네트워크 정보가 전달될 수 있어요.</p>
      <p>완료한 비밀번호 검사는 시각·결과·발견 횟수만 이력에 자동 저장해요. 입력한 비밀번호와 변환값은 앱에 보내거나 저장하지 않아요. 화면 이동·검사 종류 전환·새로고침 때 입력을 지우며 중단·실패 검사는 저장하지 않아요.</p>
      <p>내 Google 계정의 최근 30일·최신 100개 기록만 표시해요. 같은 계정으로 로그인한 다른 브라우저에서도 볼 수 있고, 삭제는 내 기록에만 적용돼요. 기존 웹·Windows 버전의 기록은 자동으로 옮기거나 삭제하지 않아요.</p>
      {session.local_preview && <p>지금은 미리보기용 별도 기록 보관을 사용해요. 공개 앱의 기록과 공유하지 않아요.</p>}
      <button type="button" className="gg-primary-button" onClick={() => setPrivacy(false)}>알겠어요</button>
    </Modal>
  </div>;
}
