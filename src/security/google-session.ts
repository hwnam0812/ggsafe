import { api, ApiError } from "../lib/api";

export const GOOGLE_SESSION_STORAGE = "ggsafe.google.preview.session.v2";
export const GOOGLE_SESSION_INVALID = "ggsafe:session-invalid";
const lifetime = 72 * 60 * 60_000;
type SavedSession = { key: string; expires: number };
let memory: SavedSession | null = null;
let csrf: string | null = null;
let persisted = false;
const validKey = (key: unknown): key is string => typeof key === "string" && /^[A-Za-z0-9_-]{43}$/.test(key);

export function resetGoogleSessionMemory() { memory = null; csrf = null; persisted = false; }

export function forgetGoogleSession() {
  resetGoogleSessionMemory();
  try { window.localStorage.removeItem(GOOGLE_SESSION_STORAGE); } catch { /* 저장소가 차단돼도 메모리는 지운다. */ }
  try { window.sessionStorage.removeItem("ggsafe.google.preview.session.v1"); } catch { /* 과거 탭 연결 키만 정리하고 기존 이력은 건드리지 않는다. */ }
}

export function googleSessionKey(): string | null {
  try {
    const raw = window.localStorage.getItem(GOOGLE_SESSION_STORAGE);
    const saved: unknown = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === "object" && "key" in saved && "expires" in saved && validKey(saved.key) &&
        typeof saved.expires === "number" && Number.isFinite(saved.expires) && saved.expires <= Date.now() + lifetime + 5000) {
      if (memory?.key !== saved.key) csrf = null;
      memory = { key: saved.key, expires: saved.expires }; persisted = true;
    } else if (raw || persisted) resetGoogleSessionMemory();
  } catch { /* 저장소가 차단되면 현재 화면의 연결만 쓴다. */ }
  if (!memory || memory.expires <= Date.now()) return null;
  return memory.key;
}

export function createGoogleSessionKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function rememberGoogleSession(key: string, expiresAt: string | null, confirmation?: string | null) {
  const expires = Date.parse(expiresAt ?? "");
  if (!validKey(key) || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + lifetime + 5000) {
    throw new Error("연결 유지 시간을 확인하지 못했어요. Google 로그인을 다시 시도해 주세요.");
  }
  // Google 토큰·계정 정보가 아닌 앱 전용 무작위 키와 만료 시각만 보관한다.
  // localStorage여서 브라우저 재실행에도 유지된다. 확인값은 메모리에서만 쓴다.
  memory = { key, expires: memory?.key === key ? Math.max(memory.expires, expires) : expires };
  csrf = validKey(confirmation) ? confirmation : csrf;
  try { window.localStorage.setItem(GOOGLE_SESSION_STORAGE, JSON.stringify(memory)); persisted = true; } catch { /* 저장 차단 시 현재 화면만 유지한다. */ }
}

function invalidateIfCurrent(key: string | null) {
  const current = googleSessionKey();
  if (key && (current === key || (!current && memory?.key === key))) {
    forgetGoogleSession();
    window.dispatchEvent(new Event(GOOGLE_SESSION_INVALID));
  }
}

export async function googleApi<T>(path: string, init: RequestInit = {}, key = googleSessionKey()): Promise<T> {
  if (!/^\/api\/preview-google\/(session|activity|prepare|identity|finish|cancel|logout)$/.test(path)) throw new Error("지원하지 않는 연결 요청이에요.");
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  // 빈 헤더도 보낸다. 저장된 연결 키를 지웠을 때 오래된 쿠키로 다시 연결하지 않는다.
  headers["x-ggsafe-session"] = key ?? "";
  if (csrf && !headers["x-ggsafe-csrf"]) headers["x-ggsafe-csrf"] = csrf;
  try { return await api<T>(path, { ...init, headers }); }
  catch (error) {
    if (error instanceof ApiError && error.status === 401) invalidateIfCurrent(key);
    throw error;
  }
}

export async function securityApi<T>(path: string, init: RequestInit = {}, expectedKey = googleSessionKey()): Promise<T> {
  if (!/^\/api\/security\/(history|history\/password|email)$/.test(path)) throw new Error("지원하지 않는 검사 요청이에요.");
  const key = googleSessionKey();
  if (key !== expectedKey) {
    if (!key) invalidateIfCurrent(expectedKey);
    throw new Error("계정이 바뀌었어요. 현재 계정에서 다시 시도해 주세요.");
  }
  if (!key || !csrf) {
    invalidateIfCurrent(key);
    throw new ApiError("Google로 로그인한 후 이용해 주세요.", 401);
  }
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  headers["x-ggsafe-session"] = key;
  headers["x-ggsafe-csrf"] = csrf;
  try {
    const response = await api<T>(path, { ...init, headers });
    if (googleSessionKey() !== key) {
      invalidateIfCurrent(key);
      throw new ApiError("로그인 상태가 바뀌었어요. 현재 계정에서 다시 시도해 주세요.", 401);
    }
    return response;
  }
  catch (error) {
    if (error instanceof ApiError && error.status === 401) invalidateIfCurrent(key);
    throw error;
  }
}
