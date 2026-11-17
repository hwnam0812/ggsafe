import EmailScan from "../security/EmailScan";
import GoogleChecks from "../security/GoogleChecks";
import PasswordScan from "../security/PasswordScan";
import { KeyRound, Mail, Shield } from "lucide-react";
import { useSearchParams } from "react-router";

export default function SecurityScan() {
  const [params, setParams] = useSearchParams();
  const kind = params.get("tab") === "password" ? "password" : "email";
  const password = kind === "password";
  function select(value: string) { setParams(value === "password" ? { tab: "password" } : {}); }
  return <>
    <div className="gg-page-heading"><div><p>확인할 수 있는 것부터 정확하게</p><h1>보안 검사</h1></div></div>
    <div className="gg-inspection-intro"><Shield size={25} aria-hidden="true"/><div><strong>이메일과 비밀번호, 따로 확인해요.</strong><p>이메일은 로그인한 주소만 검사해요. 비밀번호는 직접 입력하며 Google에서 가져오지 않아요.</p></div></div>
    <div className="gg-scan-tabs" role="tablist" aria-label="검사 종류">{[{ value: "email", title: "이메일 유출 검사", icon: Mail }, { value: "password", title: "비밀번호 유출 검사", icon: KeyRound }].map(({ value, title, icon: Icon }) => <button key={value} type="button" role="tab" id={`scan-tab-${value}`} aria-controls="scan-tab-panel" aria-selected={kind === value} tabIndex={kind === value ? 0 : -1} onClick={() => select(value)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "email" : event.key === "End" ? "password" : password ? "email" : "password"; select(next); document.getElementById(`scan-tab-${next}`)?.focus(); } }}><Icon size={18} aria-hidden="true"/>{title}</button>)}</div>
    <div className="gg-scan-page-layout" role="tabpanel" id="scan-tab-panel" aria-labelledby={`scan-tab-${kind}`} tabIndex={0}>
      {password ? <PasswordScan/> : <EmailScan/>}
      <aside className="gg-scan-explainer"><h2>검사는 이렇게 진행해요</h2><ol>{(password ? [
        ["이 기기에서 변환", "입력한 비밀번호를 기기 안에서 변환해요. 입력하는 동안에는 조회하지 않아요."],
        ["앞 5글자만 전송", "동의 후 버튼을 누르면 변환값 일부만 보내요. 원문과 전체 변환값은 보내지 않아요."],
        ["결과 확인과 이력 저장", "이 기기에서 비교한 뒤 시각·결과·발견 횟수만 내 계정에 남겨요. 비밀번호와 변환값은 저장하지 않아요."],
      ] : [
        ["로그인한 이메일 확인", "표시된 내 이메일을 확인하고 외부 전송에 동의해요."],
        ["공개된 유출 기록 조회", "XposedOrNot에서 조회해요. 정상 결과는 5분 동안 재사용할 수 있어요."],
        ["결과 확인과 보안 조치", "유출 서비스와 검사 시각을 확인하고 해결 가이드를 살펴보세요."],
      ]).map(([title, text], index) => <li key={title}><span>{index + 1}</span><div><strong>{title}</strong><p>{text}</p></div></li>)}</ol><div className="gg-notice">{password ? "이 검사는 비밀번호의 알려진 유출 여부만 확인해요. 내 계정의 현재 해킹 여부나 비밀번호 강도를 판정하지 않아요." : "조회 오류는 ‘유출 기록 없음’으로 표시하지 않아요. 계정 전체의 안전을 판정하는 검사는 아니에요."}</div></aside>
    </div><GoogleChecks/>
  </>;
}
