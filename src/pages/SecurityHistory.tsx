import { useState } from "react";
import { Clock3, History, Info, KeyRound, LoaderCircle, RefreshCw, Shield, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { formatDate, useSecurity } from "../security/SecurityProvider";
import Modal from "../security/Modal";

export default function SecurityHistory() {
  const { state: { history, historyLoading, historyError }, actions: { refreshHistory, clearHistory } } = useSecurity();
  const [filter, setFilter] = useState("all");
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const rows = history.filter(row => filter === "all" || (filter === "completed" ? ["breached", "not_found"].includes(row.status) : !["breached", "not_found"].includes(row.status)));
  async function remove() {
    setDeleting(true);
    try { await clearHistory(); setConfirm(false); setError(""); }
    catch { setError("기록을 지우지 못했어요. 잠시 후 다시 시도해 주세요."); }
    finally { setDeleting(false); }
  }
  return <>
    <div className="gg-page-heading"><div><p>내가 확인한 보안 기록</p><h1>검사 이력</h1></div><button type="button" className="gg-secondary-button gg-small-button" onClick={() => void refreshHistory()}><RefreshCw size={15} aria-hidden="true"/>새로고침</button></div>
    <div className="gg-inspection-intro"><History size={25} aria-hidden="true"/><div><strong>내 계정의 이메일·비밀번호 검사 기록이에요.</strong><p>같은 Google 계정으로 로그인하면 다른 브라우저에서도 최근 30일 기록을 볼 수 있어요.</p></div></div>
    <div className="gg-history-explained"><Info size={19} aria-hidden="true"/><div><strong>비밀번호 없이, 검사 결과만 남겨요.</strong><p>비밀번호 검사를 완료하면 시각·결과·발견 횟수가 자동 저장돼요. 원문과 변환값은 저장하지 않아요. 이메일 검사는 ‘이력 저장’을 선택해야 남아요.</p><Link to="/scan?tab=password">비밀번호 검사하기</Link></div></div>
    <section className="gg-panel gg-history-panel">
      <div className="gg-history-toolbar"><div className="gg-filter-tabs" role="group" aria-label="검사 이력 필터">{[["all", "전체"], ["completed", "검사 완료"], ["error", "검사 미완료"]].map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div><button type="button" className="gg-delete-button" onClick={() => setConfirm(true)} disabled={history.length === 0}><Trash2 size={15} aria-hidden="true"/>기록 삭제</button></div>
      {historyError ? <p role="alert" className="gg-inline-warning">{historyError}</p> : historyLoading ? <div className="gg-history-empty" role="status"><LoaderCircle className="gg-spinning" aria-hidden="true"/><p>기록을 불러오고 있어요…</p></div> : rows.length === 0 ? <div className="gg-history-empty"><div><Clock3 size={35} aria-hidden="true"/></div><h2>{history.length ? "해당하는 검사 기록이 없어요" : "아직 저장한 검사 이력이 없어요"}</h2><p>{history.length ? "다른 필터를 선택해 기록을 살펴보세요." : "비밀번호 검사를 완료하거나 이메일 검사에서 이력 저장을 선택해 주세요."}</p><Link to="/scan?tab=password" className="gg-primary-button">비밀번호 검사하러 가기</Link></div> : <div className="gg-history-table-wrap"><table className="gg-history-table"><thead><tr><th scope="col">검사 항목</th><th scope="col">조회 시각</th><th scope="col">결과</th><th scope="col">발견 기록</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.scan_type}:${row.id}`}><td data-label="검사 항목"><span className="gg-table-label">{row.scan_type === "password" ? <KeyRound size={16} aria-hidden="true"/> : <Shield size={16} aria-hidden="true"/>}{row.scan_type === "password" ? "비밀번호 유출 검사" : "이메일 유출 검사"}</span>{Boolean(row.cached) && <small>최근 조회 결과 재사용</small>}</td><td data-label="조회 시각">{formatDate(row.checked_at)}</td><td data-label="결과"><span className={`gg-badge ${row.status === "breached" ? "gg-badge-warning" : "gg-badge-muted"}`}>{row.status === "breached" ? "유출 기록 발견" : row.status === "not_found" ? "유출 기록 미발견" : "검사 미완료"}</span></td><td data-label="발견 기록">{["breached", "not_found"].includes(row.status) ? `${row.breach_count.toLocaleString("ko-KR")}${row.scan_type === "password" ? "회" : "개"}` : "확인 불가"}</td></tr>)}</tbody></table></div>}
    </section>
    <p className="gg-history-note">두 검사를 합쳐 최근 30일, 최대 100개를 표시해요. 비밀번호의 발견 횟수는 계정·서비스 개수가 아니에요. 이전 브라우저 전용 기록은 어느 계정에도 연결하지 않아 여기에 보이지 않지만, 기존 기록 자체는 삭제하지 않아요.</p>
    <Modal title="검사 이력을 삭제할까요?" open={confirm} onClose={() => { if (!deleting) setConfirm(false); }}><p>지금 로그인한 Google 계정의 이메일·비밀번호 검사 이력을 모두 삭제해요. 다른 브라우저에서도 이 계정의 기록이 사라지며, 삭제한 기록은 되돌릴 수 없어요. 다른 계정과 이전 브라우저 전용 기록은 지우지 않아요.</p>{error && <p className="gg-form-error" role="alert">{error}</p>}<div className="gg-modal-actions"><button className="gg-secondary-button" type="button" disabled={deleting} onClick={() => setConfirm(false)}>취소</button><button className="gg-danger-button" type="button" disabled={deleting} onClick={() => void remove()}>{deleting ? "삭제 중…" : "검사 이력 삭제"}</button></div></Modal>
  </>;
}
