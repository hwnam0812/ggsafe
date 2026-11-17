import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { sha256, type Bindings } from "./lib";
import { withSecurityStorageRetry } from "./security-storage";

export type AccountSession = { owner: string; emailHash: string };

// Google 검증을 마친 미리보기 처리기만 이 표에 앱 연결을 발급한다.
// 브라우저가 적어 보낸 이메일·소유자·기존 브라우저 구분값은 신원으로 믿지 않는다.
export async function securitySession(c: Context<{ Bindings: Bindings }>): Promise<AccountSession | null> {
  const token = c.req.header("X-GGSAFE-Session");
  const csrf = c.req.header("X-GGSAFE-CSRF");
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token) || !csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf)) return null;
  const tokenHash = await sha256(token);
  const row = await withSecurityStorageRetry(() => c.env.DB.prepare("SELECT owner_key, email_hash, csrf_hash FROM security_account_sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(tokenHash, Date.now()).first<{ owner_key: string; email_hash: string; csrf_hash: string }>());
  if (!row || !/^google:v1:[a-f0-9]{64}$/.test(row.owner_key) || !/^[a-f0-9]{64}$/.test(row.email_hash) || !/^[a-f0-9]{64}$/.test(row.csrf_hash)) return null;
  if (!timingSafeEqual(new TextEncoder().encode(await sha256(csrf)), new TextEncoder().encode(row.csrf_hash))) return null;
  return { owner: row.owner_key, emailHash: row.email_hash };
}
