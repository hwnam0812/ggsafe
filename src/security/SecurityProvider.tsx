import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createSecurityClient } from "../lib/security-client";
import type { PasswordHistoryInput, ScanHistory, ScanResult } from "../lib/security-types";
import { googleSessionKey, securityApi } from "./google-session";
import { useGoogle } from "./GoogleProvider";

type ScanInput = { consent: boolean; remember: boolean; force: boolean };
type SecurityContextValue = {
  state: { email: string; result: ScanResult | null; busy: boolean; history: ScanHistory[]; historyLoading: boolean; historyError: string };
  actions: { scan: (input: ScanInput) => Promise<void>; retryEmailHistory: () => Promise<void>; savePasswordHistory: (input: PasswordHistoryInput) => Promise<void>; refreshHistory: () => Promise<void>; clearHistory: () => Promise<void> };
};
const SecurityContext = createContext<SecurityContextValue | null>(null);

export function SecurityProvider({ children, email }: { children: ReactNode; email: string }) {
  const { actions: { ensureActive } } = useGoogle();
  // 계정 연결마다 별도 클라이언트를 만든다. 이전 계정의 늦은 작업이 새 키를 쓰지 못한다.
  const [securityClient] = useState(() => {
    const key = googleSessionKey();
    return createSecurityClient(<T,>(path: string, init?: RequestInit) => securityApi<T>(path, init, key));
  });
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ScanHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const pendingHistory = useRef<Promise<void> | null>(null);
  const pendingScan = useRef(false);
  const pendingEmailSave = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const refreshHistory = useCallback((): Promise<void> => {
    if (pendingHistory.current) return pendingHistory.current;
    const request = (async () => {
      try {
        const response = await securityClient.history();
        if (!mounted.current) return;
        setHistory(response.rows);
        setHistoryError("");
      } catch { if (mounted.current) setHistoryError("검사 이력을 불러오지 못했어요. 다시 불러와 주세요."); }
      finally { if (mounted.current) setHistoryLoading(false); pendingHistory.current = null; }
    })();
    pendingHistory.current = request;
    return request;
  }, [securityClient]);
  useEffect(() => { void refreshHistory(); }, [refreshHistory]);

  const scan = useCallback(async (input: ScanInput) => {
    if (!input.consent || pendingScan.current || pendingEmailSave.current) return;
    pendingScan.current = true;
    setBusy(true);
    setResult(null);
    try {
      await ensureActive();
      if (!mounted.current) return;
      const response = await securityClient.scan({ ...input, email });
      if (!mounted.current) return;
      setResult(response);
      if (pendingHistory.current) await pendingHistory.current;
      await refreshHistory();
    } catch (error) {
      if (mounted.current) setResult({ status: "network_error", message: error instanceof Error ? error.message : "검사를 완료하지 못했어요. 다시 시도해 주세요.", breach_count: 0, breaches: [], checked_at: new Date().toISOString(), source: "XposedOrNot", cached: false, history_saved: false, history_requested: input.remember });
    } finally { if (mounted.current) setBusy(false); pendingScan.current = false; }
  }, [email, ensureActive, refreshHistory, securityClient]);

  const retryEmailHistory = useCallback(async () => {
    if (!result?.history_id || pendingEmailSave.current || pendingScan.current) return;
    pendingEmailSave.current = true;
    const id = result.history_id;
    try {
      await ensureActive();
      if (!mounted.current) return;
      await securityClient.retryEmailHistory(id);
      if (!mounted.current) return;
      setResult(current => current?.history_id === id ? { ...current, history_saved: true } : current);
      if (pendingHistory.current) await pendingHistory.current;
      await refreshHistory();
    } finally { pendingEmailSave.current = false; }
  }, [result, ensureActive, securityClient, refreshHistory]);

  const savePasswordHistory = useCallback(async (input: PasswordHistoryInput) => {
    await securityClient.savePasswordHistory(input);
    if (!mounted.current) return;
    // 저장 전부터 진행 중이던 조회가 새 기록을 덮어쓰지 않게 한 번 더 읽는다.
    if (pendingHistory.current) await pendingHistory.current;
    await refreshHistory();
  }, [refreshHistory, securityClient]);

  const clearHistory = useCallback(async () => {
    await ensureActive();
    if (!mounted.current) return;
    await securityClient.clearHistory();
    if (!mounted.current) return;
    setHistory([]);
    setResult(null);
  }, [ensureActive, securityClient]);

  const value = useMemo(() => ({ state: { email, result, busy, history, historyLoading, historyError }, actions: { scan, retryEmailHistory, savePasswordHistory, refreshHistory, clearHistory } }), [email, result, busy, history, historyLoading, historyError, scan, retryEmailHistory, savePasswordHistory, refreshHistory, clearHistory]);
  return <SecurityContext value={value}>{children}</SecurityContext>;
}

export function useSecurity() {
  const context = use(SecurityContext);
  if (!context) throw new Error("SecurityProvider is required");
  return context;
}

export const formatDate = (value: string, withTime = true) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "시각 확인 불가";
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(date);
};
