// Google 확인을 마친 미리보기 처리기만 연결을 발급한다. Google 토큰은 받지 않는다.
// 실제 미리보기와 Worker는 같은 로컬 저장소를 읽고, 단위 검사는 메모리 저장소를 쓴다.
import { withSecurityStorageRetry as retry } from "../worker/security-storage.ts";

export function memoryGoogleSessions() {
  const rows = new Map();
  return {
    async get(id, now) { const row = rows.get(id); return row && row.expires_at > now ? { ...row } : null; },
    async count(now) { return [...rows.values()].filter(row => row.expires_at > now).length; },
    async insert(id, row) { if (rows.has(id)) throw new Error("Duplicate session"); rows.set(id, { ...row }); },
    async touch(id, now, expires) {
      const row = rows.get(id);
      if (!row || row.expires_at <= now) return null;
      row.expires_at = Math.max(row.expires_at, expires);
      return { ...row };
    },
    async remove(id, expires) { if (expires === undefined || rows.get(id)?.expires_at === expires) rows.delete(id); },
    async purge(now) { for (const [id, row] of rows) if (row.expires_at <= now) rows.delete(id); },
  };
}

export function databaseGoogleSessions(db) {
  return {
    get: (id, now) => retry(() => db.prepare("SELECT * FROM security_account_sessions WHERE token_hash = ? AND expires_at > ?").bind(id, now).first()),
    async count(now) { return (await retry(() => db.prepare("SELECT COUNT(*) AS total FROM security_account_sessions WHERE expires_at > ?").bind(now).first())).total; },
    async insert(id, row) {
      await retry(async () => {
        const inserted = await db.prepare("INSERT INTO security_account_sessions (token_hash, owner_key, email_hash, csrf_hash, private_json, expires_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token_hash) DO NOTHING RETURNING token_hash")
          .bind(id, row.owner_key, row.email_hash, row.csrf_hash, row.private_json, row.expires_at).first();
        if (inserted) return;
        // 저장 후 응답만 실패했다면 같은 발급 내용을 복구한다. 다른 연결은 덮어쓰지 않는다.
        const existing = await db.prepare("SELECT * FROM security_account_sessions WHERE token_hash = ?").bind(id).first();
        if (!existing || ["owner_key", "email_hash", "csrf_hash", "private_json"].some(key => existing[key] !== row[key])) throw new Error("Duplicate session");
      });
    },
    touch: (id, now, expires) => retry(() => db.prepare("UPDATE security_account_sessions SET expires_at = MAX(expires_at, ?) WHERE token_hash = ? AND expires_at > ? RETURNING *").bind(expires, id, now).first()),
    async remove(id, expires) {
      const query = expires === undefined
        ? db.prepare("DELETE FROM security_account_sessions WHERE token_hash = ?").bind(id)
        : db.prepare("DELETE FROM security_account_sessions WHERE token_hash = ? AND expires_at = ?").bind(id, expires);
      await retry(() => query.run());
    },
    async purge(now) { await retry(() => db.prepare("DELETE FROM security_account_sessions WHERE expires_at <= ?").bind(now).run()); },
  };
}
