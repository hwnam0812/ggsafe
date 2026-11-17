import type { PasswordHistoryInput, ScanHistory, ScanResult } from "./security-types";

type Requester = <T>(path: string, init?: RequestInit) => Promise<T>;
type HistoryResponse = { rows: ScanHistory[] };

// 소유자는 서버가 검증한 Google 계정에서 결정한다. 브라우저 이력 키는 더 이상 읽거나 쓰지 않는다.
export function createSecurityClient(request: Requester) {
  let pending: Promise<HistoryResponse> | null = null;
  function history(): Promise<HistoryResponse> {
    if (pending) return pending;
    pending = request<HistoryResponse>("/api/security/history").finally(() => { pending = null; });
    return pending;
  }
  return {
    history,
    async scan(input: { email: string; consent: boolean; remember: boolean; force: boolean }) {
      if (!input.consent) throw new Error("이메일 외부 전송에 먼저 동의해 주세요.");
      return request<ScanResult>("/api/security/email", { method: "POST", body: JSON.stringify({ email: input.email, consent: true, save_history: input.remember, force_refresh: input.force }) });
    },
    async savePasswordHistory(input: PasswordHistoryInput) {
      const response = await request<{ history_saved: boolean }>("/api/security/history/password", {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        // 객체 전체를 직렬화하지 않는다. 비밀번호·해시·이메일은 이 요청에 넣을 수 없다.
        body: JSON.stringify({ id: input.id, status: input.status, count: input.count, checked_at: input.checked_at }),
      });
      if (response.history_saved !== true) throw new Error("이력을 저장하지 못했어요. 다시 시도해 주세요.");
    },
    async clearHistory() {
      return request<{ ok: boolean }>("/api/security/history", { method: "DELETE", body: JSON.stringify({ confirm: true }) });
    },
  };
}
