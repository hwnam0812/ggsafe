import { BridgeError, getSnapshot, invalidate, nativeRequest } from "./bridge";

export function googleSessionKey(): string | null {
  const session = getSnapshot().session;
  return session.user && Date.parse(session.expires_at ?? "") > Date.now() ? session.connection_id : null;
}
export async function securityApi<T>(path: string, init: RequestInit = {}, expected = googleSessionKey()): Promise<T> {
  if (!expected || expected !== googleSessionKey()) throw new BridgeError("Google로 로그인한 후 이용해 주세요.", 401);
  const action = path === "/api/security/email" ? "email" : path === "/api/security/history/password" ? "password" : path === "/api/security/history" ? init.method === "DELETE" ? "clear" : "history" : null;
  if (!action) throw new BridgeError("지원하지 않는 검사 요청이에요.", 400);
  const value = await nativeRequest<T>(action, init.body ? JSON.parse(String(init.body)) : {}, { connection: expected, signal: init.signal ?? undefined });
  if (expected !== googleSessionKey()) {
    invalidate(); throw new BridgeError("계정이 바뀌었어요. 현재 계정에서 다시 시도해 주세요.", 401);
  }
  return value;
}
