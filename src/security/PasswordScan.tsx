import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Check, ChevronRight, Clock3, ExternalLink, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, RefreshCw, ShieldAlert, Square, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { checkPassword, PASSWORD_SOURCE, type PasswordResult } from "../lib/password-check";
import type { PasswordHistoryInput } from "../lib/security-types";
import { formatDate, useSecurity } from "./SecurityProvider";
import { useGoogle } from "./GoogleProvider";

export default function PasswordScan() {
  const { actions: { savePasswordHistory } } = useSecurity();
  const { actions: { ensureActive } } = useGoogle();
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PasswordResult | null>(null);
  const [error, setError] = useState("");
  const [historyState, setHistoryState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const historyEntry = useRef<PasswordHistoryInput | null>(null);
  const savingEntry = useRef<PasswordHistoryInput | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    const clear = () => {
      request.current?.abort(); request.current = null;
      if (input) input.value = "";
      historyEntry.current = null;
      setPassword(""); setVisible(false); setConsent(false); setBusy(false); setResult(null); setError(""); setHistoryState("idle");
    };
    window.addEventListener("pagehide", clear);
    return () => { request.current?.abort(); request.current = null; historyEntry.current = null; if (input) input.value = ""; window.removeEventListener("pagehide", clear); };
  }, []);

  function resetResult() { request.current?.abort(); request.current = null; historyEntry.current = null; setHistoryState("idle"); setBusy(false); setResult(null); setError(""); }
  function clear() { resetResult(); setPassword(""); setVisible(false); setConsent(false); inputRef.current?.focus(); }
  function cancel() { resetResult(); setError("검사를 중단했어요. 전송된 변환값 일부는 되돌릴 수 없어요."); }
  async function persist(entry: PasswordHistoryInput) {
    if (savingEntry.current === entry) return;
    savingEntry.current = entry;
    setHistoryState("saving");
    try {
      await savePasswordHistory(entry);
      if (historyEntry.current === entry) setHistoryState("saved");
    } catch {
      if (historyEntry.current === entry) setHistoryState("error");
    } finally { if (savingEntry.current === entry) savingEntry.current = null; }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    if (!password.length) { setError("검사할 비밀번호를 입력해 주세요."); inputRef.current?.focus(); return; }
    if (!consent) { setError("변환값 일부를 외부로 보내는 데 동의한 후 검사해 주세요."); consentRef.current?.focus(); return; }
    const controller = new AbortController(); request.current = controller;
    historyEntry.current = null;
    setHistoryState("idle"); setResult(null); setError(""); setBusy(true);
    try {
      // 잠들었던 탭에서도 만료된 로그인으로 외부 조회를 시작하지 않게 직전에 확인한다.
      await ensureActive();
      if (request.current !== controller || controller.signal.aborted) return;
      const next = await checkPassword(password, { consent, signal: controller.signal });
      if (request.current === controller && !controller.signal.aborted) {
        setResult(next);
        const entry: PasswordHistoryInput = { id: crypto.randomUUID(), status: next.status, count: next.count, checked_at: next.checked_at };
        historyEntry.current = entry;
        void persist(entry);
      }
    } catch (cause) {
      if (request.current === controller) setError(cause instanceof Error ? cause.message : "검사를 완료하지 못했어요. 다시 검사해 주세요.");
    } finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }

  return <section className="gg-panel gg-password-scan" aria-labelledby="password-scan-title">
    <div className="gg-panel-heading"><div className="gg-feature-icon gg-purple"><KeyRound size={23} aria-hidden="true"/></div><span className={`gg-badge${result?.status === "found" ? " gg-badge-warning" : ""}`}>{busy ? "검사 중" : error ? "확인 필요" : result ? "검사 완료" : "원문 전송 없음"}</span></div>
    <h2 id="password-scan-title">비밀번호 유출 검사</h2>
    <p className="gg-panel-description">입력한 비밀번호가 알려진 유출 기록에 있는지 확인해요. Google 로그인과는 별개의 검사예요.</p>
    <div className="gg-password-privacy" id="password-privacy"><LockKeyhole size={18} aria-hidden="true"/><p><strong>비밀번호 원문은 밖으로 보내지 않아요.</strong><span>기기에서 만든 변환값의 앞 5글자만 HIBP Pwned Passwords에 보내요. 비밀번호 원문·전체 변환값·이메일은 보내지 않아요.</span></p></div>
    <form className="gg-scan-form" onSubmit={event => void submit(event)} autoComplete="off" noValidate>
      <label htmlFor="scan-password">검사할 비밀번호 <span aria-hidden="true">*</span></label>
      <div className="gg-email-field gg-password-field"><KeyRound size={18} aria-hidden="true"/><input ref={inputRef} id="scan-password" name="password_check" type={visible ? "text" : "password"} value={password} onChange={event => { resetResult(); setPassword(event.target.value); setConsent(false); }} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-required="true" aria-describedby="password-input-help password-privacy" placeholder="검사할 비밀번호를 입력해 주세요…"/><button type="button" className="gg-password-reveal" onClick={() => setVisible(!visible)} aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"} aria-pressed={visible}>{visible ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}</button></div>
      <p id="password-input-help" className="gg-field-help">이곳은 로그인 입력란이 아니에요. 입력·붙여넣기만으로는 조회하지 않아요.</p>
      <label className="gg-checkbox gg-password-consent"><input ref={consentRef} name="password_range_consent" autoComplete="off" type="checkbox" checked={consent} onChange={event => { resetResult(); setConsent(event.target.checked); }} aria-describedby="password-privacy"/><span>변환값 앞 5글자의 외부 전송에 동의해요. <span className="gg-required">필수</span></span></label>
      <button type="submit" className="gg-primary-button gg-scan-button" disabled={busy}>{busy ? <LoaderCircle size={18} className="gg-spinning" aria-hidden="true"/> : result || error ? <RefreshCw size={18} aria-hidden="true"/> : <KeyRound size={18} aria-hidden="true"/>}{busy ? "유출 비밀번호 확인 중…" : result || error ? "비밀번호 다시 검사" : "비밀번호 검사하기"}</button>
      <div className="gg-password-actions">{busy && <button type="button" className="gg-secondary-button" onClick={cancel}><Square size={13} aria-hidden="true"/>검사 중단</button>}<button type="button" className="gg-secondary-button" disabled={!password && !result && !error} onClick={clear}><Trash2 size={15} aria-hidden="true"/>입력 지우기</button></div>
      <p className="gg-password-storage">검사를 완료하면 시각·결과·발견 횟수만 이력에 자동 저장해요. 비밀번호 원문과 변환값은 저장하지 않아요. 입력한 비밀번호는 화면을 떠나면 지워져요.</p>
    </form>
    <div aria-live="polite">{busy && <div className="gg-scan-progress" role="status"><span/><p>변환값 일부로 기록을 받아 이 기기에서 비교하고 있어요.</p></div>}</div>
    {error && <div className="gg-result gg-result-error" role="alert"><div className="gg-result-heading"><AlertCircle size={22} aria-hidden="true"/><h3>검사를 완료하지 못했어요</h3></div><p>{error}</p></div>}
    {result && <div className={`gg-result ${result.status === "found" ? "gg-result-warning" : "gg-result-complete"}`} role="status"><div className="gg-result-heading">{result.status === "found" ? <ShieldAlert size={22} aria-hidden="true"/> : <Check size={22} aria-hidden="true"/>}<h3>{result.status === "found" ? "동일한 비밀번호가 유출 기록에 있어요" : "알려진 유출 기록에서 찾지 못했어요"}</h3></div>{result.status === "found" ? <><p>이 비밀번호는 공개 유출 자료에 등장해요. 사용 중이라면 해당 서비스에서 다른 비밀번호로 바꿔 주세요.</p><div className="gg-found-count"><strong>{result.count.toLocaleString("ko-KR")}</strong><span>회 발견 · 계정이나 서비스 개수가 아니에요</span></div><p className="gg-result-caution">내 계정이 해킹됐다는 뜻은 아니에요. 어느 계정·서비스에서 유출됐는지는 알 수 없어요.</p><Link to="/guide#password" className="gg-result-link">비밀번호 변경 시 알아둘 점<ChevronRight size={16} aria-hidden="true"/></Link></> : <><p>현재 조회 가능한 공개 유출 자료와 일치하지 않아요.</p><p className="gg-result-caution">안전하거나 강한 비밀번호라는 보장은 아니에요. 다른 서비스에서 재사용하지 마세요.</p></>}<div className="gg-result-meta"><span><Clock3 size={13} aria-hidden="true"/>조회 · {formatDate(result.checked_at)}</span><span>{historyState === "saving" ? "검사 이력 저장 중…" : historyState === "saved" ? "검사 이력 저장됨" : "이력 저장 안 됨"}</span></div>{historyState === "saved" && <Link to="/history" className="gg-result-link">검사 이력 보기<ChevronRight size={16} aria-hidden="true"/></Link>}{historyState === "error" && <div className="gg-password-history-warning"><p>검사는 완료했지만 이력은 저장하지 못했어요. 비밀번호를 다시 보내지 않고 저장만 재시도할 수 있어요.</p><button type="button" className="gg-secondary-button" onClick={() => { if (historyEntry.current) void persist(historyEntry.current); }}>이력 저장 다시 시도</button></div>}</div>}
    <a className="gg-source-link" href={PASSWORD_SOURCE} target="_blank" rel="noopener noreferrer">조회 출처 · HIBP Pwned Passwords 공식 안내<ExternalLink size={12} aria-hidden="true"/></a>
  </section>;
}
