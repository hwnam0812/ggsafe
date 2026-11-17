import { createContext, use, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { getSnapshot, invalidate, nativeRequest, subscribe } from "./bridge";
import { googleSessionKey } from "./google-session";

const signalName = "ggsafe.streamlit.logout.v1";
function broadcastLogout() {
  const value = crypto.randomUUID();
  try { localStorage.setItem(signalName, value); } catch { /* 로그인 쿠키는 Streamlit이 관리한다. */ }
  try { const channel = new BroadcastChannel(signalName); channel.postMessage(value); channel.close(); } catch { /* 저장 이벤트를 함께 사용한다. */ }
}
function useNativeGoogle() {
  const { session, ready } = useSyncExternalStore(subscribe, getSnapshot);
  const [operation, setOperation] = useState<"idle" | "login" | "logout">("idle");
  const [error, setError] = useState("");
  const ensureActive = useCallback(async () => {
    const connection = googleSessionKey();
    if (!connection) { invalidate(); throw new Error("Google로 다시 로그인해 주세요."); }
    await nativeRequest("session", {}, { connection });
    if (googleSessionKey() !== connection) throw new Error("로그인 상태가 바뀌었어요. 다시 로그인해 주세요.");
  }, []);
  const refresh = useCallback(async () => {
    if (getSnapshot().session.user) await ensureActive().catch(() => invalidate());
    else window.parent.postMessage({ isStreamlitMessage: true, type: "streamlit:componentReady", apiVersion: 1 }, "*");
  }, [ensureActive]);
  const login = useCallback(async (switching = false) => {
    setOperation("login"); setError("");
    if (switching) { broadcastLogout(); invalidate(""); }
    try { await nativeRequest(switching ? "switch" : "login"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "로그인을 시작하지 못했어요."); setOperation("idle"); }
  }, []);
  const logout = useCallback(async () => {
    setOperation("logout"); setError(""); broadcastLogout(); invalidate("");
    try { await nativeRequest("logout"); }
    catch { setError("로그아웃을 완료하지 못했어요. 화면을 새로고침해 주세요."); setOperation("idle"); }
  }, []);
  useEffect(() => {
    let received = false;
    const lockOtherTab = () => {
      if (received || !getSnapshot().session.user) return;
      received = true; invalidate("다른 탭에서 로그아웃하거나 계정을 변경했어요.");
      void nativeRequest("logout").catch(() => {});
    };
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel(signalName); channel.onmessage = lockOtherTab; } catch { /* 저장 이벤트로도 알린다. */ }
    const storage = (event: StorageEvent) => { if (event.key === signalName) lockOtherTab(); };
    const visible = () => { if (document.visibilityState === "visible" && getSnapshot().session.user) void ensureActive().catch(() => invalidate()); };
    window.addEventListener("storage", storage); window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    const timer = window.setInterval(visible, 60000);
    return () => { channel?.close(); window.clearInterval(timer); window.removeEventListener("storage", storage); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [ensureActive]);
  useEffect(() => {
    if (!session.user || !session.expires_at) return;
    const timer = window.setTimeout(() => { if (!googleSessionKey()) { invalidate("로그인 시간이 지났어요. Google로 다시 로그인해 주세요."); void nativeRequest("logout").catch(() => {}); } }, Math.min(2147000000, Math.max(0, Date.parse(session.expires_at) - Date.now())));
    return () => window.clearTimeout(timer);
  }, [session.user, session.expires_at]);
  return useMemo(() => ({ state: { session, loading: !ready, operation, error: error || session.error }, actions: { ensureActive, refresh, login, logout } }), [session, ready, operation, error, ensureActive, refresh, login, logout]);
}
const Context = createContext<ReturnType<typeof useNativeGoogle> | null>(null);
export function GoogleProvider({ children }: { children: ReactNode }) { return <Context value={useNativeGoogle()}>{children}</Context>; }
export function useGoogle() { const value = use(Context); if (!value) throw new Error("GoogleProvider is required"); return value; }
