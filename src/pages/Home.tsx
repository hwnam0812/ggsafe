import { ArrowUpRight, Check, ChevronRight, Clock3, KeyRound, Shield, ShieldAlert } from "lucide-react";
import { Link } from "react-router";
import EmailScan from "../security/EmailScan";
import GoogleChecks from "../security/GoogleChecks";
import { formatDate, useSecurity } from "../security/SecurityProvider";

export default function Home() {
  const { state: { result, history, historyLoading, historyError } } = useSecurity();
  const latest = result && (!history[0] || Date.parse(result.checked_at) >= Date.parse(history[0].checked_at)) ? result : history[0];
  const latestPassword = latest && "scan_type" in latest && latest.scan_type === "password";
  const completed = history.filter(row => row.status === "breached" || row.status === "not_found").length;
  const isBreached = latest?.status === "breached";
  const isComplete = isBreached || latest?.status === "not_found";
  const status = !latest ? historyError ? "검사 이력을 확인하지 못했어요" : "아직 검사하지 않았어요" : isBreached ? "확인이 필요한 유출 기록이 있어요" : isComplete ? "공개 유출 기록 조회를 마쳤어요" : "최근 검사를 완료하지 못했어요";
  return <>
    <div className="gg-page-heading"><div><p>내 정보를 지키는 첫걸음</p><h1>보안 대시보드</h1></div><span className="gg-today">{formatDate(new Date().toISOString(), false)}</span></div>
    <section className={`gg-hero ${isBreached ? "gg-hero-warning" : ""}`}><div className="gg-hero-copy"><span className="gg-hero-status"><span/>{status}</span><h2>{isBreached ? <>발견한 기록부터,<br/>하나씩 안전하게.</> : isComplete ? <>확인하는 습관이<br/>나의 계정을 지켜요.</> : <>내 계정의 안전,<br/>확인에서 시작해요.</>}</h2><p>{isBreached ? latestPassword ? "발견된 비밀번호를 사용 중이라면,\n다른 비밀번호로 바꿔 주세요." : "유출된 서비스와 권장 조치를 확인하고,\n재사용하는 비밀번호부터 바꿔 보세요." : "공개된 유출 기록을 확인하고,\n필요한 보안 조치를 차근차근 알아보세요."}</p>{isBreached ? <Link to="/guide" className="gg-hero-button">해결 가이드 보기<ArrowUpRight size={18}/></Link> : <a href="#email-scan" className="gg-hero-button">이메일 검사 시작<ArrowUpRight size={18}/></a>}</div><div className="gg-shield-scene" aria-hidden="true"><span className="gg-orbit gg-orbit-outer"/><span className="gg-orbit gg-orbit-inner"/><div className="gg-shield-base">{isBreached ? <ShieldAlert size={91} strokeWidth={1.2}/> : <Shield size={91} strokeWidth={1.2}/>}</div><div className="gg-shield-caption">{isComplete ? <Check size={13}/> : <Clock3 size={13}/>}<span>{isComplete ? "유출 조회 완료" : "검사 대기 중"}</span></div><span className="gg-orbit-dot gg-dot-one"/><span className="gg-orbit-dot gg-dot-two"/></div></section>
    <section className="gg-metrics" aria-label="검사 요약">
      <div><span>완료한 검사</span><strong>{historyLoading || historyError ? "—" : `${completed}회`}</strong><small>내 Google 계정에 저장된 이력</small></div>
      <div><span>최근 유출 기록</span><strong className={isBreached ? "gg-text-warning" : ""}>{!latest ? historyError ? "확인 불가" : "미검사" : isComplete ? `${latest.breach_count.toLocaleString("ko-KR")}${latestPassword ? "회" : "개"}` : "확인 불가"}</strong><small>{latestPassword ? "비밀번호가 유출 자료에 등장한 횟수" : isBreached ? "관련 유출 서비스 수" : "공개된 유출 데이터 기준"}</small></div>
      <div><span>최근 검사 시각</span><strong className="gg-metric-date">{latest ? new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(latest.checked_at)) : historyError ? "확인 불가" : "아직 없어요"}</strong><small>{latest ? isComplete ? "실제 조회 시각 기준" : "마지막 시도 시각 기준" : "첫 검사를 시작해 보세요"}</small></div>
    </section>
    <div className="gg-section-heading"><h2>나의 보안 검사</h2><span><span className="gg-live-dot"/>확인한 결과만 표시해요</span></div>
    <div className="gg-scan-grid"><EmailScan/><section className="gg-panel gg-password-panel"><div className="gg-panel-heading"><div className="gg-feature-icon gg-purple"><KeyRound size={23} aria-hidden="true"/></div><span className="gg-badge">검사 가능</span></div><h2>비밀번호 유출 검사</h2><p className="gg-panel-description">비밀번호 원문을 보내지 않고<br/>알려진 유출 기록과 비교해요.</p><div className="gg-password-visual" aria-hidden="true"><div><span/><span/><span/><span/><span/><span/><KeyRound size={23}/></div><p>비밀번호 원문은 나에게만</p></div><p className="gg-password-note">동의 후 변환값의 앞 5글자만 보내요.<br/>완료하면 시각·결과·발견 횟수만 이력에 남아요.</p><Link to="/scan?tab=password" className="gg-secondary-button">비밀번호 검사 시작<ChevronRight size={16} aria-hidden="true"/></Link></section></div>
    <GoogleChecks/>
    <section className="gg-recent"><div className="gg-section-heading"><h2>최근 검사 이력</h2><Link to="/history">전체 보기<ChevronRight size={15}/></Link></div>{historyError ? <p className="gg-inline-warning">{historyError}</p> : historyLoading ? <p className="gg-empty-small">이력을 불러오고 있어요…</p> : history.length ? <div className="gg-history-preview">{history.slice(0, 3).map(row => <div key={`${row.scan_type}:${row.id}`}><span className="gg-history-icon">{row.scan_type === "password" ? <KeyRound size={18} aria-hidden="true"/> : <Shield size={18} aria-hidden="true"/>}</span><div><strong>{row.scan_type === "password" ? "비밀번호 유출 검사" : "이메일 유출 검사"}</strong><span>{formatDate(row.checked_at)}</span></div><span className={`gg-badge ${row.status === "breached" ? "gg-badge-warning" : "gg-badge-muted"}`}>{row.status === "breached" ? `유출 기록 ${row.breach_count.toLocaleString("ko-KR")}${row.scan_type === "password" ? "회" : "개"}` : row.status === "not_found" ? "유출 기록 미발견" : "검사 미완료"}</span></div>)}</div> : <div className="gg-empty-small"><Clock3 size={21}/><p>비밀번호 검사를 완료하면 이곳에 남아요. 이메일은 이력 저장을 선택해 주세요.</p></div>}</section>
  </>;
}
