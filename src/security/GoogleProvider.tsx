import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { googleApi as api, createGoogleSessionKey, forgetGoogleSession, googleSessionKey, rememberGoogleSession, GOOGLE_SESSION_INVALID, GOOGLE_SESSION_STORAGE } from "./google-session";
import { loadGoogleIdentity } from "./google-identity";

type GoogleSession = {
  available: boolean;
  preview_only: boolean;
  user: { email: string } | null;
  csrf: string | null;
  connection_id: string | null;
  expires_at: string | null;
};
type Flow = { verifier: string; id: string; controller: AbortController; timer?: number; completing: boolean };
type Operation = "idle" | "login" | "logout";
type GoogleContextValue = {
  state: { session: GoogleSession; loading: boolean; operation: Operation; error: string; buttonReady: boolean };
  actions: { refresh: () => Promise<void>; ensureActive: () => Promise<void>; mountButton: (element: HTMLElement) => () => void; cancel: () => void; logout: () => Promise<void> };
  meta: { javascriptOrigin: string };
};
const base = "/api/preview-google";
const emptySession: GoogleSession = { available: false, preview_only: true, user: null, csrf: null, connection_id: null, expires_at: null };
const GoogleContext = createContext<GoogleContextValue | null>(null);

function release(flow: Flow) {
  window.clearTimeout(flow.timer);
  flow.controller.abort();
  if (flow.id) void api(`${base}/cancel`, { method: "POST", body: JSON.stringify({ flow_id: flow.id, verifier: flow.verifier }) }).catch(() => {});
}

export function GoogleProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<GoogleSession>(emptySession);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<Operation>("idle");
  const [error, setError] = useState("");
  const [buttonReady, setButtonReady] = useState(false);
  const active = useRef<Flow | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const revision = useRef(0);
  const operationRef = useRef<Operation>("idle");
  const sessionRef = useRef(session);
  const activeKey = useRef<string | null>(null);
  const pendingActivity = useRef<Promise<void> | null>(null);

  const applySession = useCallback((next: GoogleSession, key: string | null) => {
    if (next.user && key) {
      if (sessionRef.current.connection_id === next.connection_id && Date.parse(sessionRef.current.expires_at ?? "") > Date.parse(next.expires_at ?? "")) {
        next = { ...next, expires_at: sessionRef.current.expires_at };
      }
      rememberGoogleSession(key, next.expires_at, next.csrf);
    }
    activeKey.current = key;
    sessionRef.current = next;
    setSession(next);
  }, []);

  const lock = useCallback((message = "로그인 시간이 지났어요. Google로 다시 로그인해 주세요.") => {
    revision.current++;
    const next = { ...emptySession, available: sessionRef.current.available };
    activeKey.current = null; sessionRef.current = next;
    setSession(next); setLoading(false); setError(message);
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (!import.meta.env.DEV) { setLoading(false); return Promise.resolve(); }
    if (operationRef.current !== "idle") return Promise.resolve();
    if (pending.current) return pending.current;
    const expectedRevision = revision.current;
    const key = googleSessionKey();
    let request: Promise<void> | null = null;
    request = (async () => {
      try {
        const next = await api<GoogleSession>(`${base}/session`);
        if (revision.current === expectedRevision && operationRef.current === "idle" && googleSessionKey() === key) {
          if (!next.user) forgetGoogleSession();
          applySession(next, next.user ? key : null);
          setError("");
        } else if (revision.current === expectedRevision && operationRef.current === "idle" && key && !googleSessionKey()) {
          // 응답을 기다리는 사이 기한이 지났어도 이전 화면을 다시 보여주지 않는다.
          // 새 계정의 키가 있다면 이 응답은 무시하고 그 계정의 확인을 기다린다.
          forgetGoogleSession();
          lock();
        }
      } catch {
        if (revision.current === expectedRevision && operationRef.current === "idle") lock("로그인을 확인하지 못해 화면을 잠갔어요. 연결 상태를 확인한 뒤 다시 불러와 주세요.");
      }
      finally {
        if (revision.current === expectedRevision) setLoading(false);
        if (pending.current === request) pending.current = null;
      }
    })();
    pending.current = request;
    return request;
  }, [applySession, lock]);

  const touch = useCallback((at: number): Promise<void> => {
    if (pendingActivity.current) return pendingActivity.current;
    const current = sessionRef.current;
    const key = googleSessionKey();
    if (!current.user || !key || operationRef.current !== "idle") {
      if (current.user && !key) { forgetGoogleSession(); lock(); }
      return Promise.reject(new Error("Google로 로그인한 후 이용해 주세요."));
    }
    const expectedRevision = revision.current;
    const request = (async () => {
      const next = await api<GoogleSession>(`${base}/activity`, { method: "POST", body: JSON.stringify({ at }), headers: { "x-ggsafe-csrf": current.csrf ?? "" } });
      if (revision.current !== expectedRevision || googleSessionKey() !== key || operationRef.current !== "idle" || !next.user || next.connection_id !== current.connection_id) throw new Error("계정이 바뀌었어요. 현재 계정에서 다시 시도해 주세요.");
      applySession(next, key);
    })().finally(() => { if (pendingActivity.current === request) pendingActivity.current = null; });
    pendingActivity.current = request;
    return request;
  }, [applySession, lock]);
  const ensureActive = useCallback(() => touch(Date.now()), [touch]);

  useEffect(() => {
    let mounted = true;
    let timer: number | undefined;
    let lastEvent = 0;
    // 화면에 실제로 다시 방문한 한 번만 이용으로 계산한다. 자동 조회·타이머는 연장하지 않는다.
    const visit = async () => {
      if (operationRef.current !== "idle") return;
      if (!sessionRef.current.user || Date.parse(sessionRef.current.expires_at ?? "") <= Date.now()) setLoading(true);
      await refresh();
      if (mounted && sessionRef.current.user) await ensureActive().catch(() => {});
    };
    void visit();
    const onVisible = (event: Event) => { if (event.isTrusted && document.visibilityState === "visible") void visit(); };
    const onActivity = (event: Event) => {
      if (!event.isTrusted || document.visibilityState !== "visible" || !sessionRef.current.user || operationRef.current !== "idle") return;
      lastEvent = Date.now();
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        if (document.visibilityState === "visible" && Date.now() - lastEvent < 60_000) void touch(lastEvent).catch(() => {});
      }, 800);
    };
    const onInvalid = () => lock();
    const onStorage = (event: StorageEvent) => {
      if (event.key !== GOOGLE_SESSION_STORAGE && event.key !== null) return;
      const key = googleSessionKey();
      if (key !== activeKey.current) { lock(""); setLoading(true); pending.current = null; }
      void refresh();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    window.addEventListener("storage", onStorage);
    window.addEventListener(GOOGLE_SESSION_INVALID, onInvalid);
    for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(type, onActivity, { capture: true, passive: true });
    return () => {
      mounted = false; window.clearTimeout(timer);
      window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible); window.removeEventListener("storage", onStorage); window.removeEventListener(GOOGLE_SESSION_INVALID, onInvalid);
      for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) window.removeEventListener(type, onActivity, true);
    };
  }, [refresh, ensureActive, lock, touch]);
  useEffect(() => {
    if (!session.user || !session.expires_at) return;
    const expires = Date.parse(session.expires_at);
    const timer = window.setTimeout(() => {
      // 다른 탭의 연장 여부도 확인하되 이 확인 자체로 기한을 연장하지 않는다.
      setLoading(true); void refresh();
    }, Number.isFinite(expires) ? Math.max(0, expires - Date.now()) : 0);
    return () => window.clearTimeout(timer);
  }, [session.user, session.expires_at, refresh]);
  useEffect(() => () => {
    const flow = active.current;
    if (flow) { active.current = null; release(flow); }
  }, []);

  const cancel = useCallback(() => {
    const flow = active.current;
    if (!flow) return;
    revision.current++;
    active.current = null;
    release(flow);
    setButtonReady(false);
    operationRef.current = "idle"; setOperation("idle");
    setError("로그인 대기를 취소했어요. 원할 때 다시 연결해 주세요.");
  }, []);

  const mountButton = useCallback((element: HTMLElement) => {
    if (!session.available || operationRef.current !== "idle") return () => {};
    if (active.current) release(active.current);
    const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, "0")).join("");
    const flow: Flow = { verifier, id: "", controller: new AbortController(), completing: false };
    active.current = flow;
    revision.current++;
    setError(""); setButtonReady(false);
    const fail = (message: string) => {
      if (active.current !== flow) return;
      active.current = null; release(flow); element.replaceChildren();
      operationRef.current = "idle"; setOperation("idle"); setButtonReady(false); setError(message);
    };
    flow.timer = window.setTimeout(() => fail("로그인 준비 시간이 지났어요. 로그인 버튼을 다시 준비해 주세요."), 10 * 60_000);
    void (async () => {
      try {
        const identity = await loadGoogleIdentity();
        if (active.current !== flow) return;
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
        const challenge = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
        const prepared = await api<{ flow_id: string; client_id: string; nonce: string; state: string }>(`${base}/prepare`, {
          method: "POST", body: JSON.stringify({ origin: window.location.origin, challenge, mode: "identity" }), signal: flow.controller.signal
        });
        flow.id = prepared.flow_id;
        if (active.current !== flow) { release(flow); return; }
        identity.initialize({
          client_id: prepared.client_id, nonce: prepared.nonce, ux_mode: "popup", auto_select: false, use_fedcm_for_button: false,
          callback: response => { void (async () => {
            if (active.current !== flow || flow.completing) return;
            flow.completing = true;
            operationRef.current = "login"; setOperation("login"); setButtonReady(false);
            try {
              await api(`${base}/identity`, { method: "POST", body: JSON.stringify({ flow_id: flow.id, verifier, credential: response.credential, state: response.state }), signal: flow.controller.signal });
              if (active.current !== flow) return;
              const sessionKey = createGoogleSessionKey();
              const next = await api<{ state: string; session?: GoogleSession }>(`${base}/finish`, { method: "POST", body: JSON.stringify({ flow_id: flow.id, verifier, session_key: sessionKey }), signal: flow.controller.signal });
              if (active.current !== flow) return;
              flow.id = "";
              if (next.state !== "complete" || !next.session?.user) throw new Error("Google 연결을 완료하지 못했어요. 로그인 버튼을 다시 준비해 주세요.");
              const confirmed = await api<GoogleSession>(`${base}/session`, { signal: flow.controller.signal }, sessionKey);
              if (active.current !== flow) return;
              if (!confirmed.user || confirmed.connection_id !== next.session.connection_id) throw new Error("연결 정보를 다시 확인하지 못했어요. 미리보기를 새로고침한 뒤 Google 로그인을 다시 시도해 주세요.");
              applySession(confirmed, sessionKey);
              active.current = null; release(flow); setError("");
              operationRef.current = "idle"; setOperation("idle");
            } catch (cause) { fail(cause instanceof Error ? cause.message : "Google 연결에 실패했어요. 다시 준비해 주세요."); }
          })(); }
        });
        identity.renderButton(element, { type: "standard", theme: "outline", size: "large", text: "continue_with", locale: "ko", width: Math.min(360, element.clientWidth || 280), state: prepared.state,
          click_listener: () => { if (active.current === flow) { operationRef.current = "login"; setOperation("login"); } }
        });
        setButtonReady(true);
      } catch (cause) { fail(cause instanceof Error ? cause.message : "Google 로그인 버튼을 준비하지 못했어요."); }
    })();
    return () => {
      if (active.current !== flow) return;
      active.current = null; release(flow); element.replaceChildren();
      operationRef.current = "idle"; setOperation("idle"); setButtonReady(false);
    };
  }, [session.available, applySession]);

  const logout = useCallback(async () => {
    if (operationRef.current !== "idle") return;
    if (active.current) { release(active.current); active.current = null; setButtonReady(false); }
    revision.current++;
    operationRef.current = "logout"; setOperation("logout"); setError("");
    try {
      const next = await api<GoogleSession>(`${base}/logout`, { method: "POST", headers: { "x-ggsafe-csrf": session.csrf ?? "" }, body: JSON.stringify({}) });
      forgetGoogleSession();
      applySession(next, null);
      window.google?.accounts?.id?.disableAutoSelect();
    } catch { setError("연결을 해제하지 못했어요. 새로고침 후 다시 시도해 주세요."); }
    finally { operationRef.current = "idle"; setOperation("idle"); }
  }, [session.csrf, applySession]);

  const value = useMemo(() => ({ state: { session, loading, operation, error, buttonReady }, actions: { refresh, ensureActive, mountButton, cancel, logout }, meta: { javascriptOrigin: window.location.origin } }), [session, loading, operation, error, buttonReady, refresh, ensureActive, mountButton, cancel, logout]);
  return <GoogleContext value={value}>{children}</GoogleContext>;
}

export function useGoogle() {
  const context = use(GoogleContext);
  if (!context) throw new Error("GoogleProvider is required");
  return context;
}
