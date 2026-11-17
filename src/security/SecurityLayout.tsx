import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { BookOpen, ChevronRight, CircleHelp, History, LayoutDashboard, LockKeyhole, ScanLine, Shield, ShieldCheck } from "lucide-react";
import { SecurityProvider } from "./SecurityProvider";
import Modal from "./Modal";
import GoogleAccount from "./GoogleAccount";
import { GoogleProvider, useGoogle } from "./GoogleProvider";

const navigation = [
  { to: "/", title: "대시보드", icon: LayoutDashboard },
  { to: "/scan", title: "보안 검사", icon: ScanLine },
  { to: "/guide", title: "해결 가이드", icon: BookOpen },
  { to: "/history", title: "검사 이력", icon: History }
];

export default function SecurityLayout() {
  return <GoogleProvider><ConnectedWorkspace/></GoogleProvider>;
}

function ConnectedWorkspace() {
  const { state: { session, loading, operation, error }, actions: { refresh } } = useGoogle();
  if (loading || operation === "logout") return <div className="gg-login-page"><main className="gg-login-card" aria-busy="true"><ShieldCheck size={42} aria-hidden="true"/><h1>{operation === "logout" ? "로그아웃하고 있어요…" : "로그인을 확인하고 있어요…"}</h1><p role="status">내 계정의 기록을 안전하게 준비해요.</p></main></div>;
  if (!session.user) return <div className="gg-login-page"><main className="gg-login-card"><a href="#login-start" className="gg-login-brand"><Shield size={30} aria-hidden="true"/>GGSAFE</a><div className="gg-login-symbol"><LockKeyhole size={38} aria-hidden="true"/></div><h1>내 계정으로<br/>안전하게 시작해요.</h1><p>Google로 로그인하면 내 이메일을 검사하고,<br/>내 계정의 검사 이력을 확인할 수 있어요.</p><div id="login-start"><GoogleAccount/></div>{error && <div className="gg-login-error"><p className="gg-form-error" role="alert">{error}</p><button type="button" className="gg-text-button" onClick={() => void refresh()}>로그인 상태 다시 확인</button></div>}<div className="gg-login-details"><strong>마지막 이용으로부터 3일간 로그인 유지</strong><p>다시 이용하면 3일로 연장돼요.<br/>Google 비밀번호는 가져오지 않아요.</p></div><small>검사는 로그인 후 별도 동의와 버튼 클릭으로 시작해요.</small></main></div>;
  // 계정 연결·전환·해제 시 입력, 동의, 현재 결과를 새로 시작해 이전 계정의 결과를 섞지 않습니다.
  return <SecurityProvider key={session.connection_id ?? "anonymous"} email={session.user.email}><SecurityShell/></SecurityProvider>;
}

function SecurityShell() {
  const [dialog, setDialog] = useState<"privacy" | null>(null);
  const { pathname } = useLocation();
  const current = navigation.find(item => item.to === pathname)?.title ?? "대시보드";
  return <div className="gg-app">
    <a href="#main-content" className="gg-skip">본문 바로가기</a>
    <aside className="gg-sidebar">
      <NavLink to="/" className="gg-brand" aria-label="GGSAFE 대시보드"><Shield size={32} strokeWidth={2.3}/><span>GGSAFE<span className="gg-brand-dot">.</span></span></NavLink>
      <p className="gg-brand-caption">나의 계정을 위한 안전한 습관</p>
      <nav className="gg-navigation" aria-label="주 메뉴">{navigation.map(({ to, title, icon: Icon }) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `gg-nav-item ${isActive ? "is-active" : ""}`}><Icon size={19} aria-hidden="true"/><span>{title}</span><ChevronRight size={15} className="gg-nav-chevron" aria-hidden="true"/></NavLink>)}</nav>
      <div className="gg-sidebar-bottom"><div className="gg-privacy-note"><LockKeyhole size={22}/><strong>개인정보는 최소한으로</strong><p>Google 비밀번호와 이메일 원문을 검사 이력에 저장하지 않아요.</p><button type="button" onClick={() => setDialog("privacy")}>개인정보 처리 안내 <ChevronRight size={13}/></button></div><span className="gg-version">GGSAFE · 0.1.1 개발 중</span></div>
    </aside>
    <div className="gg-workspace">
      <header className="gg-topbar"><NavLink to="/" className="gg-mobile-brand"><Shield size={25}/>GGSAFE</NavLink><div className="gg-breadcrumb">내 보안 공간 <ChevronRight size={13}/><span>{current}</span></div><div className="gg-topbar-actions"><button type="button" className="gg-icon-button" onClick={() => setDialog("privacy")} aria-label="개인정보 처리 안내"><CircleHelp size={20}/></button><GoogleAccount/></div></header>
      <nav className="gg-mobile-nav" aria-label="모바일 주 메뉴">{navigation.map(({ to, title, icon: Icon }) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => isActive ? "is-active" : ""}><Icon size={17}/><span>{title}</span></NavLink>)}</nav>
      <main id="main-content" className="gg-main"><Outlet/></main>
      <footer className="gg-footer"><ShieldCheck size={16}/><span>확인한 정보만 표시해요. 유출 기록 미발견이 계정의 안전을 보장하지는 않아요.</span><button type="button" onClick={() => setDialog("privacy")}>개인정보 안내</button></footer>
    </div>
    <Modal title="개인정보 처리 안내" open={dialog !== null} onClose={() => setDialog(null)}>
      <p>마지막 실제 이용으로부터 3일 동안 로그인 상태를 유지해요. 다시 방문하거나 조작하면 그 시점부터 3일로 연장되지만, 탭을 켜둔 상태의 자동 조회만으로는 연장되지 않아요.</p>
      <p><strong>이메일 검사를 실행할 때만</strong> 동의한 이메일 주소를 XposedOrNot에 전송해요.</p>
      <p>Google 공식 창에서 확인한 이메일로만 로그인해요. Google 비밀번호·로그인 토큰·이름·사진·메일함은 보관하지 않고 Drive 권한도 요청하지 않아요. 앱 연결 키의 해시와 계정 구분값, 암호화한 로그인 복구 정보만 기한 동안 보관해요. 로그아웃하면 해당 연결을 폐기해요.</p>
      <p>이 브라우저에는 계정 정보가 들어 있지 않은 GGSAFE 전용 무작위 연결 키와 만료 시각만 보관해요. 브라우저를 다시 열어도 연결을 유지하지만, 브라우저 저장을 차단하거나 연결 정보를 삭제하면 다시 로그인해야 할 수 있어요.</p>
      <p>이메일은 해시값으로 구분하고, 정상 조회 결과는 5분 동안 재사용해요. 오류 결과는 재사용하지 않아요. 이력 저장을 선택하면 검사 시각·상태·발견 개수만 기록해요. 이메일 원문과 서비스 목록은 검사 이력에 저장하지 않아요.</p>
      <p>비밀번호 검사는 별도 동의 후 검사 버튼을 눌렀을 때만 기기에서 만든 변환값의 앞 5글자를 HIBP Pwned Passwords에 전송해요. 원문·전체 변환값·이메일·Google 연결 정보는 보내지 않아요. 외부 서비스에는 접속에 필요한 네트워크 정보가 전달될 수 있어요.</p>
      <p>비밀번호 검사를 완료하면 검사 시각·결과·발견 횟수만 GGSAFE 이력에 자동 저장해요. 원문과 변환값의 전부 또는 일부는 이력에 보내거나 저장하지 않아요. 입력한 비밀번호는 검사 종류 전환·화면 이동·새로고침 때 지워져요. 완료하지 못했거나 중단한 검사는 기록하지 않아요.</p>
      <p>두 종류의 검사 이력은 로그인한 Google 계정별로 보관해요. 같은 계정으로 로그인한 다른 브라우저에서도 최근 30일, 최신 100개를 함께 볼 수 있어요. 검사 이력에서 내 계정의 기록만 삭제할 수 있어요. 다른 기기의 첫 이용에는 별도 로그인이 필요해요.</p>
      <p>이전 브라우저 전용 기록은 계정을 확인할 수 없어 어느 계정에도 연결하거나 보여주지 않아요. 기존 기록 자체는 삭제하지 않아요. 미리보기에서 남긴 기록과 연결 정보는 프로젝트의 저장된 버전으로 되돌리면 초기화돼요.</p>
      <button className="gg-primary-button" onClick={() => setDialog(null)}>알겠어요</button>
    </Modal>
  </div>;
}
