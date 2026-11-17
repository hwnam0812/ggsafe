import type { Context, Hono } from "hono";
import { sha256, type Bindings } from "./lib";
import type { ScanResult } from "../src/lib/security-types";
import { createEmailResult as result, parseEmailResponse } from "./security-response";
import { securitySession } from "./security-session";
import { withSecurityStorageRetry as retry } from "./security-storage";

type SecurityContext = Context<{ Bindings: Bindings }>;
const TTL = 300;

async function limitedText(body: ReadableStream<Uint8Array> | null, maximum: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new Error("Response size limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

function cleanup(c: SecurityContext) {
  const now = Math.floor(Date.now() / 1000);
  c.executionCtx.waitUntil(retry(() => c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM security_cache WHERE expires_at < ?").bind(now),
    c.env.DB.prepare("DELETE FROM security_inflight WHERE expires_at < ?").bind(now),
    // 소유 계정을 알 수 없는 기존 브라우저 기록은 연결하지도, 정리로 삭제하지도 않는다.
    c.env.DB.prepare("DELETE FROM security_history WHERE owner_key LIKE 'google:v1:%' AND created_at < ?").bind(new Date(Date.now() - 30 * 864e5).toISOString()),
    c.env.DB.prepare("DELETE FROM security_password_history WHERE owner_key LIKE 'google:v1:%' AND created_at < ?").bind(new Date(Date.now() - 30 * 864e5).toISOString()),
    c.env.DB.prepare("DELETE FROM rate_limit WHERE window_start < ? AND key LIKE 'security:%'").bind(now - 3600)
  ])).catch(() => { console.warn(JSON.stringify({ event: "security_cleanup_failed" })); }));
}

async function record(c: SecurityContext, owner: string, scan: ScanResult, enabled: boolean): Promise<boolean> {
  if (!enabled || scan.status === "in_progress") return false;
  const id = crypto.randomUUID(), created = new Date().toISOString();
  try {
    await retry(() => c.env.DB.prepare("INSERT INTO security_history (id, owner_key, status, breach_count, checked_at, created_at, cached) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
      .bind(id, owner, scan.status, scan.breach_count, scan.checked_at, created, scan.cached ? 1 : 0).run());
    return true;
  } catch {
    console.warn(JSON.stringify({ event: "security_history_save_failed" }));
    return false;
  }
}

export function mountSecurity(app: Hono<{ Bindings: Bindings }>) {
  app.get("/security/history", async c => {
    const session = await securitySession(c);
    if (!session) return c.json({ error: "Google로 로그인한 후 검사 이력을 볼 수 있어요." }, 401);
    const { owner } = session;
    cleanup(c);
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
    const { results } = await retry(() => c.env.DB.prepare(`
      SELECT id, 'email' AS scan_type, status, breach_count, checked_at, created_at, cached
      FROM security_history WHERE owner_key = ? AND created_at >= ?
      UNION ALL
      SELECT id, 'password' AS scan_type, status, breach_count, checked_at, created_at, 0 AS cached
      FROM security_password_history WHERE owner_key = ? AND created_at >= ?
      ORDER BY created_at DESC, id DESC LIMIT 100
    `).bind(owner, cutoff, owner, cutoff).all());
    c.header("Cache-Control", "no-store");
    return c.json({ rows: results });
  });

  app.delete("/security/history", async c => {
    const session = await securitySession(c);
    if (!session) return c.json({ error: "Google로 다시 로그인한 후 기록을 삭제해 주세요." }, 401);
    if (!c.req.header("content-type")?.includes("application/json")) return c.json({ error: "삭제 요청을 확인할 수 없어요." }, 400);
    let confirmed = false;
    try {
      const body: unknown = JSON.parse(await limitedText(c.req.raw.body, 1024));
      confirmed = !!body && typeof body === "object" && "confirm" in body && body.confirm === true;
    } catch { /* 잘못된 삭제 요청은 기록을 변경하지 않습니다. */ }
    if (!confirmed) return c.json({ error: "삭제 여부를 먼저 선택해 주세요." }, 400);
    const { owner } = session;
    await retry(() => c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM security_history WHERE owner_key = ?").bind(owner),
      c.env.DB.prepare("DELETE FROM security_password_history WHERE owner_key = ?").bind(owner),
    ]));
    return c.json({ ok: true });
  });

  app.post("/security/history/password", async c => {
    c.header("Cache-Control", "no-store");
    const session = await securitySession(c);
    if (!session) return c.json({ error: "Google로 다시 로그인한 후 이력을 저장해 주세요." }, 401);
    if (!c.req.header("content-type")?.includes("application/json")) return c.json({ error: "검사 기록의 형식을 확인해 주세요." }, 400);
    let body: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(await limitedText(c.req.raw.body, 1024));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid metadata");
      body = value as Record<string, unknown>;
    } catch { return c.json({ error: "검사 기록을 저장하지 못했어요. 다시 시도해 주세요." }, 400); }
    // 허용한 메타데이터 외의 필드는 거절하고 원문·해시·오류 본문을 기록하지 않는다.
    const allowed = ["id", "status", "count", "checked_at"];
    const checked = typeof body.checked_at === "string" ? Date.parse(body.checked_at) : NaN;
    if (Object.keys(body).length !== allowed.length || Object.keys(body).some(key => !allowed.includes(key)) ||
        typeof body.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.id) ||
        !Number.isSafeInteger(body.count) || typeof body.count !== "number" || body.count < 0 ||
        !((body.status === "found" && body.count > 0) || (body.status === "not_found" && body.count === 0)) ||
        !Number.isFinite(checked) || new Date(checked).toISOString() !== body.checked_at ||
        checked > Date.now() + 60000 || checked < Date.now() - 30 * 864e5) {
      return c.json({ error: "완료한 검사의 시각·결과·발견 횟수만 저장할 수 있어요." }, 400);
    }
    const { owner } = session;
    cleanup(c);
    try {
      // 같은 완료 결과의 저장 재시도는 중복 기록을 만들지 않는다.
      const created = new Date().toISOString();
      await retry(() => c.env.DB.prepare("INSERT INTO security_password_history (id, owner_key, status, breach_count, checked_at, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_key, id) DO NOTHING")
        .bind(body.id, owner, body.status === "found" ? "breached" : "not_found", body.count, body.checked_at, created).run());
      return c.json({ history_saved: true });
    } catch {
      console.warn(JSON.stringify({ event: "password_history_save_failed" }));
      return c.json({ error: "검사는 완료했지만 이력은 저장하지 못했어요. 이력 저장을 다시 시도해 주세요." }, 503);
    }
  });

  app.post("/security/email", async c => {
    const session = await securitySession(c);
    if (!session) return c.json({ error: "Google로 로그인한 후 내 이메일을 검사해 주세요." }, 401);
    if (!c.req.header("content-type")?.includes("application/json")) return c.json({ error: "검사 요청 형식이 올바르지 않아요." }, 400);
    let body: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(await limitedText(c.req.raw.body, 4096));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid input");
      body = value as Record<string, unknown>;
    } catch { return c.json({ error: "입력 내용을 확인하고 다시 시도해 주세요." }, 400); }
    if (body.consent !== true) return c.json({ error: "이메일 외부 전송에 동의한 후 검사해 주세요." }, 400);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) return c.json({ error: "로그인한 이메일을 확인하지 못했어요. 다시 로그인해 주세요." }, 400);
    const key = await sha256(email);
    if (key !== session.emailHash) return c.json({ error: "로그인한 Google 이메일만 검사할 수 있어요." }, 403);
    const { owner } = session;
    const now = Math.floor(Date.now() / 1000);
    const remember = body.save_history === true;
    cleanup(c);
    const finish = async (scan: ScanResult) => {
      scan.history_requested = remember;
      scan.history_saved = await record(c, owner, scan, remember);
      return c.json(scan);
    };
    if (body.force_refresh !== true) {
      const cached = await retry(() => c.env.DB.prepare("SELECT result_json FROM security_cache WHERE email_hash = ? AND expires_at > ?").bind(key, now).first<{ result_json: string }>());
      if (cached) {
        const scan = { ...JSON.parse(cached.result_json) as ScanResult, cached: true };
        return finish(scan);
      }
    }
    // 원자적 증가: 이메일 원문이나 IP 원문은 보관하지 않습니다.
    const rateKey = `security:${await sha256(owner)}:${Math.floor(now / 60)}`;
    const rate = await c.env.DB.prepare("INSERT INTO rate_limit (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count")
      .bind(rateKey, now).first<{ count: number }>();
    if ((rate?.count ?? 0) > 6) return finish(result("rate_limited", "검사 요청이 많아요. 1분 후 다시 시도해 주세요."));
    const token = crypto.randomUUID();
    const lease = await c.env.DB.prepare("INSERT INTO security_inflight (email_hash, token, expires_at) VALUES (?, ?, ?) ON CONFLICT(email_hash) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at WHERE security_inflight.expires_at <= ? RETURNING token")
      .bind(key, token, now + 25, now).first<{ token: string }>();
    if (!lease) return finish(result("in_progress", "같은 이메일의 검사가 이미 진행 중이에요. 잠시 후 다시 확인해 주세요."));

    let scan: ScanResult;
    try {
      if (body.force_refresh === true) await c.env.DB.prepare("DELETE FROM security_cache WHERE email_hash = ?").bind(key).run();
      const response = await fetch(`https://api.xposedornot.com/v1/check-email/${encodeURIComponent(email)}`, {
        headers: { Accept: "application/json", "User-Agent": "GGSAFE/0.1.1" },
        signal: AbortSignal.timeout(15000), redirect: "manual"
      });
      let payload: unknown = null;
      try { payload = JSON.parse(await limitedText(response.body, 512 * 1024)); } catch { /* 잘못된 응답은 미발견으로 처리하지 않습니다. */ }
      scan = parseEmailResponse(response.status, payload);
      if (scan.status === "breached" || scan.status === "not_found") {
        try {
          await c.env.DB.prepare("INSERT INTO security_cache (email_hash, result_json, expires_at) VALUES (?, ?, ?) ON CONFLICT(email_hash) DO UPDATE SET result_json = excluded.result_json, expires_at = excluded.expires_at")
            .bind(key, JSON.stringify(scan), Math.floor(Date.now() / 1000) + TTL).run();
        } catch { console.warn(JSON.stringify({ event: "security_cache_save_failed" })); }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[url]").replace(/[^\s@]+@[^\s@]+/g, "[email]").replaceAll(encodeURIComponent(email), "[email]").slice(0, 200) : "Unknown error";
      console.warn(JSON.stringify({ event: "email_lookup_failed", name: error instanceof Error ? error.name : "Unknown", detail }));
      scan = result(error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "network_error", "검사를 완료하지 못했어요. 연결 상태를 확인하고 잠시 후 다시 시도해 주세요.");
    } finally {
      try { await c.env.DB.prepare("DELETE FROM security_inflight WHERE email_hash = ? AND token = ?").bind(key, token).run(); }
      catch { console.warn(JSON.stringify({ event: "security_lease_release_failed" })); }
    }
    return finish(scan);
  });
}
