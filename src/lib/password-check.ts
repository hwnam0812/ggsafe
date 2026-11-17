// 비밀번호 처리는 브라우저에서만 한다. 원문·전체 해시는 저장하지 않고 결과 메타데이터만 반환한다.
export const PASSWORD_SOURCE = "https://haveibeenpwned.com/API/v3#PwnedPasswords";
export const PASSWORD_MAX_LENGTH = 1024;
export type PasswordResult = { status: "found" | "not_found"; count: number; checked_at: string };
export class PasswordCheckError extends Error {}
const invalidResponse = () => new PasswordCheckError("조회 응답을 확인하지 못했어요. 미발견 결과가 아니에요. 잠시 후 다시 검사해 주세요.");

export async function passwordHash(password: string): Promise<string> {
  if (!password.length) throw new PasswordCheckError("검사할 비밀번호를 입력해 주세요.");
  if (password.length > PASSWORD_MAX_LENGTH) throw new PasswordCheckError("비밀번호가 너무 길어요. 1,024자 이하로 검사해 주세요.");
  if (!globalThis.crypto?.subtle) throw new PasswordCheckError("이 브라우저에서는 비밀번호를 보호하며 검사할 수 없어요. 최신 브라우저에서 다시 열어 주세요.");
  // 공백·대소문자·한글을 원문 그대로 비교한다. SHA-1은 조회용이지 비밀번호 저장용이 아니다.
  const encoded = new TextEncoder().encode(password);
  try {
    const digest = await crypto.subtle.digest("SHA-1", encoded);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  } finally { encoded.fill(0); }
}

export function parsePasswordRange(text: string, suffix: string): number {
  if (!/^[A-F0-9]{35}$/i.test(suffix) || text.length > 1024 * 1024) throw invalidResponse();
  const lines = text.trim().split(/\r?\n/);
  if (!text.trim() || lines.length > 20000) throw invalidResponse();
  const seen = new Set<string>();
  let found = 0;
  let hasRealEntry = false;
  for (const line of lines) {
    const match = /^([A-F0-9]{35}):([0-9]+)$/i.exec(line);
    if (!match) throw invalidResponse();
    const hash = match[1].toUpperCase();
    const count = Number(match[2]);
    if (!Number.isSafeInteger(count) || count < 0 || seen.has(hash)) throw invalidResponse();
    seen.add(hash);
    if (count > 0) hasRealEntry = true;
    // 0은 개인정보 보호용으로 추가된 가짜 항목이므로 발견으로 표시하지 않는다.
    if (hash === suffix.toUpperCase()) found = count;
  }
  if (!hasRealEntry) throw invalidResponse();
  return found;
}

async function readRange(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw invalidResponse();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw invalidResponse();
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

// HIBP 공식 범위 조회: https://haveibeenpwned.com/API/v3#SearchingPwnedPasswordsByRange
// 별도 동의 + 버튼 클릭에서만 호출한다. fetch에 원문·전체 해시·이메일·Google 정보를 넣지 않는다.
export async function checkPassword(password: string, options: { consent: boolean; signal?: AbortSignal; fetcher?: typeof fetch; timeoutMs?: number }): Promise<PasswordResult> {
  if (options.consent !== true) throw new PasswordCheckError("변환값 일부를 외부로 보내는 데 동의한 후 검사해 주세요.");
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 15000), ...(options.signal ? [options.signal] : [])]);
  try {
    signal.throwIfAborted();
    const hash = await passwordHash(password);
    signal.throwIfAborted();
    const response = await (options.fetcher ?? fetch)(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      method: "GET", headers: { "Add-Padding": "true", Accept: "text/plain" },
      signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error",
    });
    signal.throwIfAborted();
    if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/plain")) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 429) throw new PasswordCheckError("비밀번호 조회 요청이 제한됐어요. 잠시 후 다시 검사해 주세요.");
      throw invalidResponse();
    }
    const count = parsePasswordRange(await readRange(response, signal), hash.slice(5));
    signal.throwIfAborted();
    return { status: count > 0 ? "found" : "not_found", count, checked_at: new Date().toISOString() };
  } catch (error) {
    if (options.signal?.aborted) throw new PasswordCheckError("검사를 중단했어요. 전송된 변환값 일부는 되돌릴 수 없어요.");
    if (signal.aborted) throw new PasswordCheckError("조회 시간이 길어 검사를 멈췄어요. 유출 여부는 알 수 없어요. 다시 검사해 주세요.");
    if (error instanceof PasswordCheckError) throw error;
    throw new PasswordCheckError("조회 서비스에 연결하지 못했어요. 유출 여부는 알 수 없어요. 연결을 확인한 후 다시 검사해 주세요.");
  }
}
