import { useRef, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Clock3, Database, ExternalLink, LoaderCircle, LockKeyhole, Mail, RefreshCw, ScanLine, Search } from "lucide-react";
import { Link } from "react-router";
import { useSecurity, formatDate } from "./SecurityProvider";
import { emailJourney, emailSummary } from "../lib/scan-visuals";
import { ScanJourney, ScanResultVisual } from "./ScanVisuals";

function BreachList({ names }: { names: string[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const matches = names.filter(name => name.toLowerCase().includes(query.toLowerCase()));
  const pages = Math.max(1, Math.ceil(matches.length / 10));
  return <div className="gg-breach-list"><label className="gg-search"><Search size={16}/><span className="sr-only">유출 서비스 검색</span><input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="서비스 이름 검색…" type="search"/></label><ul>{matches.slice(page * 10, (page + 1) * 10).map(name => <li key={name}><span className="gg-service-dot"/>{name}</li>)}</ul>{matches.length === 0 && <p className="gg-muted">검색 결과가 없어요.</p>}<div className="gg-pagination"><span>총 {matches.length.toLocaleString("ko-KR")}개</span><div><button type="button" onClick={() => setPage(page - 1)} disabled={page === 0} aria-label="이전 서비스 목록"><ChevronLeft size={17}/></button><span>{page + 1} / {pages}</span><button type="button" onClick={() => setPage(page + 1)} disabled={page + 1 >= pages} aria-label="다음 서비스 목록"><ChevronRight size={17}/></button></div></div></div>;
}

export default function EmailScan() {
  const { state: { email, result, busy, scanPhase }, actions: { scan, retryEmailHistory } } = useSecurity();
  const [consent, setConsent] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const consentRef = useRef<HTMLInputElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consent) { setError("이메일 외부 전송에 동의한 후 검사해 주세요."); consentRef.current?.focus(); return; }
    setError("");
    setSaveError("");
    await scan({ consent, remember, force: result !== null });
  }
  async function retrySave() {
    if (saving) return;
    setSaving(true); setSaveError("");
    try { await retryEmailHistory(); }
    catch (cause) { setSaveError(cause instanceof Error ? cause.message : "저장하지 못했어요. 잠시 후 다시 시도해 주세요."); }
    finally { setSaving(false); }
  }
  const complete = result?.status === "breached" || result?.status === "not_found";
  return <section className="gg-panel gg-email-panel" id="email-scan" aria-labelledby="email-scan-title">
    <div className="gg-panel-heading"><div className="gg-feature-icon"><Mail size={23}/></div><span className={`gg-badge ${result?.status === "breached" ? "gg-badge-warning" : ""}`}>{busy ? "검사 중" : result ? complete ? "검사 완료" : "확인 필요" : "검사 가능"}</span></div>
    <h2 id="email-scan-title">이메일 유출 검사</h2><p className="gg-panel-description">내 이메일이 공개된 유출 기록에 포함됐는지 확인해요.</p>
    <form className="gg-scan-form" onSubmit={submit}>
      <div className="gg-field-label" id="scan-email-label">로그인한 Google 이메일</div>
      <div className="gg-email-field gg-verified-email" role="group" aria-labelledby="scan-email-label" aria-describedby="email-transfer-note"><Mail size={18} aria-hidden="true"/><span translate="no">{email}</span><LockKeyhole size={16} aria-label="이메일 변경 불가"/></div>
      <p id="email-transfer-note" className="gg-field-help">이 계정의 이메일만 검사해요. 검사 버튼을 누르면 XposedOrNot에 전송돼요.</p>
      <label className="gg-checkbox"><input ref={consentRef} name="external_consent" type="checkbox" checked={consent} onChange={event => { setConsent(event.target.checked); setError(""); }} disabled={busy} aria-invalid={!!error} aria-describedby={error ? "scan-consent-error" : undefined}/><span>이메일 주소의 외부 전송에 동의해요. <span className="gg-required">필수</span></span></label>
      <div className="gg-remember-option" id="email-history-option"><label className="gg-checkbox"><input id="remember-email-history" type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} disabled={busy} aria-describedby="email-history-help"/><span>이메일 원문 없이 검사 이력을 저장해요. <span className="gg-optional">선택</span></span></label><p id="email-history-help">선택하면 검사 시각·결과·발견 개수만 내 계정에 남아요. 같은 Google 계정으로 로그인하면 다른 브라우저에서도 볼 수 있어요.</p></div>
      {error && <p id="scan-consent-error" className="gg-form-error" role="alert">{error}</p>}
      <button className="gg-primary-button gg-scan-button" type="submit" disabled={busy || saving}>{busy ? <LoaderCircle size={18} className="gg-spinning"/> : result ? <RefreshCw size={18}/> : <ScanLine size={18}/>} {busy ? "유출 기록 확인 중…" : result ? "내 이메일 다시 검사" : "내 이메일 검사하기"}</button>
      <p className="gg-form-caption"><LockNote/> {result ? "다시 검사는 이전 결과를 재사용하지 않고 새로 조회해요." : "같은 이메일의 최근 결과는 최대 5분 동안 재사용해요."}</p>
    </form>
    <ScanJourney kind="email" state={emailJourney(scanPhase, busy, result)}/>
    <div>{result && !busy && <div className={`gg-result ${result.status === "breached" ? "gg-result-warning" : complete ? "gg-result-complete" : "gg-result-error"}`} role={complete ? undefined : "alert"}>
      <ScanResultVisual kind="email" summary={emailSummary(result)} title={result.status === "breached" ? "유출 기록이 발견됐어요" : result.status === "not_found" ? "공개된 유출 기록을 찾지 못했어요" : "검사를 완료하지 못했어요"}/>
      <p>{result.message}</p>
      {result.status === "breached" && <><BreachList key={result.checked_at} names={result.breaches}/><Link to="/guide" className="gg-result-link">지금 필요한 보안 조치 보기 <ChevronRight size={16}/></Link></>}
      {result.status === "not_found" && <p className="gg-result-caution">알려지지 않은 유출까지 확인한 것은 아니며, 계정이 안전하다는 보장은 아니에요.</p>}
      <div className="gg-result-meta"><span><Clock3 size={13}/>{complete ? "조회" : "시도"} · {formatDate(result.checked_at)}</span>{complete && <span><Database size={13}/>{result.cached ? "최근 조회 결과" : "새로 조회한 결과"}</span>}</div>
      {result.history_requested && result.history_saved === false && result.status !== "in_progress" && <div className="gg-email-history-warning"><p className="gg-save-warning">{complete ? "검사는 완료했지만 이력에 저장하지 못했어요." : "이 결과는 이력에 저장하지 못했어요."}</p>{result.history_id && <><p>검사를 반복하지 않고 저장만 다시 시도할 수 있어요. 새로고침하면 저장 대기 중인 결과는 사라질 수 있어요.</p><button type="button" className="gg-secondary-button" disabled={saving} onClick={() => void retrySave()}>{saving ? <LoaderCircle size={16} className="gg-spinning" aria-hidden="true"/> : <Database size={16} aria-hidden="true"/>}{saving ? "이메일 이력 저장 중…" : "이메일 이력 저장 다시 시도"}</button></>}{saveError && <p className="gg-form-error" role="alert">{saveError}</p>}</div>}
      {result.history_saved && <p className="gg-history-saved" role="status">이메일 원문 없이 검사 이력을 저장했어요.</p>}
      {complete && result.history_requested === false && <p className="gg-history-not-saved">이번 검사는 이력 저장을 선택하지 않았어요. 기록을 남기려면 위의 저장 항목을 선택하고 다시 검사해 주세요.</p>}
    </div>}</div>
    <a className="gg-source-link" href="https://xposedornot.com/api_doc" target="_blank" rel="noopener noreferrer">조회 출처 · XposedOrNot 공식 안내<ExternalLink size={12}/></a>
  </section>;
}

function LockNote() { return <span className="gg-tiny-dot" aria-hidden="true"/>; }
