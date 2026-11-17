import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import { Hono } from "hono";
import { generateKeyPair, SignJWT } from "jose";
import { createSecurityClient } from "../src/lib/security-client.ts";
import { createGooglePreview, GOOGLE_CLIENT_ID } from "../scripts/google-preview.mjs";
import { databaseGoogleSessions } from "../scripts/google-session-store.mjs";

const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith(".") && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return next(candidate.href, context);
  }
  return next(specifier, context);
} });
const { mountSecurity } = await import("../worker/security.ts");
hook.deregister();

// 실제 계정·외부 조회 없이 시험용 Google 서명 → 실제 연결 발급 → 실제 SQL을 검사한다.
const { privateKey, publicKey } = await generateKeyPair("RS256");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const sampleEmail = "history-test-only@example.com";
const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const input = { email: sampleEmail, consent: true, remember: true, force: false };
const passwordMetadata = (changes = {}) => ({ id: randomUUID(), status: "found", count: 12345, checked_at: new Date().toISOString(), ...changes });

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema); sqlite.exec(schema);
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { bind(...values) { return {
        all: () => ({ results: statement.all(...values).map(row => ({ ...row })) }),
        first: () => statement.get(...values) ?? null,
        run: () => ({ success: true, meta: statement.run(...values) }),
      }; } };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { const result = statements.map(statement => statement.run()); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const app = new Hono().basePath("/api"); mountSecurity(app);
  const call = (path, init = {}) => app.request(path, init, { DB: db }, { waitUntil(p) { void p; } });
  const auth = createGooglePreview({ getSecret: () => "synthetic-account-session-secret", keys: publicKey, store: databaseGoogleSessions(db) });
  async function loginCall(path, body, headers = {}) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url: `/api/preview-google${path}`, method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...headers } });
    let status, data;
    const response = { statusCode: 200, setHeader() {}, getHeader() {}, end(text) { status = this.statusCode; data = JSON.parse(text); } };
    await auth(req, response, () => assert.fail("Unexpected route"));
    return { status, data };
  }
  function seedCache(email) {
    const cached = { status: "not_found", message: "모의 검사 응답이에요.", breach_count: 0, breaches: [], source: "테스트 전용", checked_at: new Date().toISOString(), cached: false };
    sqlite.prepare("INSERT OR REPLACE INTO security_cache (email_hash, result_json, expires_at) VALUES (?, ?, ?)").run(sha256(email.trim().toLowerCase()), JSON.stringify(cached), Math.floor(Date.now() / 1000) + 300);
  }
  async function account(subject = "synthetic-google-a", email = sampleEmail) {
    seedCache(email);
    const verifier = randomBytes(32).toString("hex"), key = randomBytes(32).toString("base64url");
    const prepared = await loginCall("/prepare", { origin: "http://localhost:5173", challenge: sha256(verifier), mode: "identity" });
    assert.equal(prepared.status, 200);
    const flow = prepared.data, now = Math.floor(Date.now() / 1000);
    const credential = await new SignJWT({ iss: "https://accounts.google.com", aud: GOOGLE_CLIENT_ID, sub: subject, email, email_verified: true, nonce: flow.nonce, iat: now, exp: now + 3600 }).setProtectedHeader({ alg: "RS256" }).sign(privateKey);
    assert.equal((await loginCall("/identity", { flow_id: flow.flow_id, verifier, state: flow.state, credential })).status, 200);
    const finished = await loginCall("/finish", { flow_id: flow.flow_id, verifier, session_key: key });
    assert.equal(finished.status, 200); assert.equal(finished.data.state, "complete");
    const headers = { "x-ggsafe-session": key, "x-ggsafe-csrf": finished.data.session.csrf };
    const request = (path, init = {}) => call(path, { ...init, headers: { "content-type": "application/json", ...headers, ...init.headers } });
    const transport = async (path, init) => {
      const response = await request(path, init), data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status });
      return data;
    };
    return { client: createSecurityClient(transport), request, headers, key, session: finished.data.session, logout: () => loginCall("/logout", {}, headers) };
  }
  return { sqlite, call, account, loginCall, seedCache,
    get rows() { return sqlite.prepare("SELECT * FROM security_history").all(); },
    get passwordRows() { return sqlite.prepare("SELECT * FROM security_password_history").all(); },
  };
}

test("Google 로그인 없이 검사·이력 조회·저장·삭제를 모두 막는다", async () => {
  const env = setup();
  for (const [path, method, body] of [
    ["history", "GET"], ["history", "DELETE", { confirm: true }],
    ["history/password", "POST", passwordMetadata()], ["email", "POST", { email: sampleEmail, consent: true }],
  ]) {
    const response = await env.call(`/api/security/${path}`, { method, headers: { "content-type": "application/json", "x-baze-user": "fake", "X-GGSAFE-Browser": "a".repeat(64), cookie: `ggsafe_browser=${"a".repeat(64)}` }, body: body && JSON.stringify(body) });
    assert.equal(response.status, 401);
  }
  assert.equal(env.rows.length, 0); assert.equal(env.passwordRows.length, 0);
});

test("선택 저장한 계정 이력은 새 연결·다른 브라우저에서도 이어진다", async () => {
  const env = setup(), a = await env.account();
  assert.equal((await a.client.scan(input)).history_saved, true);
  const reopened = await env.account();
  assert.notEqual(a.key, reopened.key);
  assert.equal((await reopened.client.history()).rows.length, 1);
  assert.match(env.rows[0].owner_key, /^google:v1:[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(env.rows[0]).sort(), ["breach_count", "cached", "checked_at", "created_at", "id", "owner_key", "status"]);
  assert.ok(!JSON.stringify(env.rows).includes(sampleEmail));
});

test("이메일 이력 저장을 선택하지 않으면 기록을 만들지 않는다", async () => {
  const env = setup(), { client } = await env.account();
  const result = await client.scan({ ...input, remember: false });
  assert.equal(result.history_requested, false); assert.equal(result.history_saved, false); assert.equal(env.rows.length, 0);
});

test("같은 이메일이어도 Google 고유 식별자가 다른 계정은 이력을 공유하지 않는다", async () => {
  const env = setup(), a = await env.account(), b = await env.account("synthetic-google-b");
  await a.client.scan(input); await a.client.savePasswordHistory(passwordMetadata());
  assert.equal((await a.client.history()).rows.length, 2); assert.equal((await b.client.history()).rows.length, 0);
});

test("같은 Google 식별자의 이메일이 바뀌어도 자기 이력만 이어지고 새 이메일만 검사한다", async () => {
  const env = setup(), a = await env.account(); await a.client.scan(input);
  const renamed = await env.account("synthetic-google-a", "renamed-test@example.com");
  assert.equal((await renamed.client.history()).rows.length, 1);
  assert.equal((await renamed.request("/api/security/email", { method: "POST", body: JSON.stringify({ email: sampleEmail, consent: true }) })).status, 403);
  assert.equal((await renamed.client.scan({ ...input, email: "renamed-test@example.com" })).history_saved, true);
});

test("주소를 바꾼 직접 요청은 외부 검사·저장 전에 거절한다", async () => {
  const env = setup(), a = await env.account();
  const response = await a.request("/api/security/email", { method: "POST", body: JSON.stringify({ email: "somebody-else@example.com", consent: true, save_history: true, owner_key: "fake" }) });
  assert.equal(response.status, 403); assert.equal(env.rows.length, 0);
});

test("브라우저가 적어 보낸 소유자·쿠키·예전 구분값으로 다른 계정에 접근하지 못한다", async () => {
  const env = setup(), a = await env.account(), b = await env.account("synthetic-google-b");
  await a.client.scan(input); const owner = env.rows[0].owner_key;
  const response = await b.request(`/api/security/history?owner_key=${owner}`, { headers: { "X-GGSAFE-Browser": "a".repeat(64), "x-google-sub": "synthetic-google-a", "x-ggsafe-owner": owner } });
  assert.deepEqual((await response.json()).rows, []);
  await b.request("/api/security/history", { method: "DELETE", body: JSON.stringify({ confirm: true, owner_key: owner }) });
  assert.equal((await a.client.history()).rows.length, 1);
});

test("기존 브라우저 전용 기록은 오래됐어도 노출·계정 연결·자동 정리·삭제하지 않는다", async () => {
  const env = setup(), a = await env.account(), old = new Date(Date.now() - 60 * 864e5).toISOString();
  const legacy = sha256("browser:synthetic-legacy-key");
  env.sqlite.prepare("INSERT INTO security_history VALUES (?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), legacy, "not_found", 0, old, old, 0);
  env.sqlite.prepare("INSERT INTO security_password_history VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), legacy, "not_found", 0, old, old);
  assert.deepEqual((await a.client.history()).rows, []);
  await a.client.scan(input); await a.client.clearHistory();
  assert.equal(env.rows.length, 1); assert.equal(env.rows[0].owner_key, legacy);
  assert.equal(env.passwordRows.length, 1); assert.equal(env.passwordRows[0].owner_key, legacy);
});

test("로그아웃하면 이전 키의 모든 요청을 막고 같은 계정의 다른 브라우저는 유지한다", async () => {
  const env = setup(), a = await env.account(), another = await env.account();
  await a.client.scan(input); assert.equal((await a.logout()).status, 200);
  for (const [path, method, body] of [["history", "GET"], ["history", "DELETE", { confirm: true }], ["history/password", "POST", passwordMetadata()], ["email", "POST", { email: sampleEmail, consent: true }]]) {
    assert.equal((await a.request(`/api/security/${path}`, { method, body: body && JSON.stringify(body) })).status, 401);
  }
  assert.equal((await another.client.history()).rows.length, 1);
});

test("72시간 만료된 연결은 이력 조회·저장·삭제·검사를 허용하지 않는다", async () => {
  const env = setup(), a = await env.account(); await a.client.scan(input);
  env.sqlite.prepare("UPDATE security_account_sessions SET expires_at = ? WHERE token_hash = ?").run(Date.now() - 1, sha256(a.key));
  for (const [path, method, body] of [["history", "GET"], ["history", "DELETE", { confirm: true }], ["history/password", "POST", passwordMetadata()], ["email", "POST", { email: sampleEmail, consent: true }]]) {
    assert.equal((await a.request(`/api/security/${path}`, { method, body: body && JSON.stringify(body) })).status, 401);
  }
  assert.equal(env.rows.length, 1);
});

test("앱 키만 알거나 확인값을 변조한 요청도 막는다", async () => {
  const env = setup(), a = await env.account();
  for (const csrf of ["", "incorrect", randomBytes(32).toString("base64url")]) assert.equal((await a.request("/api/security/history", { headers: { "x-ggsafe-csrf": csrf } })).status, 401);
});

test("자동 이력 조회와 저장은 로그인 기한을 조용히 연장하지 않는다", async () => {
  const env = setup(), a = await env.account();
  const expires = () => env.sqlite.prepare("SELECT expires_at FROM security_account_sessions WHERE token_hash = ?").get(sha256(a.key)).expires_at;
  const before = expires();
  await a.client.history(); await a.client.scan(input); await a.client.savePasswordHistory(passwordMetadata()); await a.client.history();
  assert.equal(expires(), before);
});

test("연결 저장소에는 Google 토큰·원본 식별자·앱 키·이메일 원문을 남기지 않는다", async () => {
  const env = setup(), a = await env.account();
  const row = env.sqlite.prepare("SELECT * FROM security_account_sessions").get();
  const stored = JSON.stringify(row);
  for (const value of [sampleEmail, "synthetic-google-a", a.key, a.session.csrf]) assert.ok(!stored.includes(value));
  assert.equal(row.token_hash, sha256(a.key)); assert.match(row.private_json, /^v1\./);
  assert.ok(!JSON.stringify(a.session).includes("subject"));
});

test("이력 조회 중복은 한 클라이언트 안에서만 합친다", async () => {
  const env = setup(), a = await env.account(); let calls = 0;
  const client = createSecurityClient(async (...args) => { calls++; return (await a.request(...args)).json(); });
  await Promise.all([client.history(), client.history(), client.history()]); assert.equal(calls, 1);
});

test("이메일 전송 동의 없이는 어떤 검사 요청도 보내지 않는다", async () => {
  let calls = 0; const client = createSecurityClient(async () => { calls++; return {}; });
  await assert.rejects(client.scan({ ...input, consent: false }), /동의/); assert.equal(calls, 0);
});

test("비밀번호 완료 기록은 메타데이터만 저장하고 새 계정 연결에도 유지한다", async () => {
  const env = setup(), a = await env.account(); await a.client.savePasswordHistory(passwordMetadata());
  assert.deepEqual(Object.keys(env.passwordRows[0]).sort(), ["breach_count", "checked_at", "created_at", "id", "owner_key", "status"]);
  const { rows } = await (await env.account()).client.history();
  assert.equal(rows.length, 1); assert.equal(rows[0].scan_type, "password"); assert.equal(rows[0].breach_count, 12345);
});

test("비밀번호 미발견은 0회로 저장하고 이메일 검사와 구분한다", async () => {
  const env = setup(), { client } = await env.account();
  await client.scan(input); await client.savePasswordHistory(passwordMetadata({ status: "not_found", count: 0 }));
  const { rows } = await client.history(); assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map(row => row.scan_type)), new Set(["email", "password"]));
  assert.equal(rows.find(row => row.scan_type === "password").breach_count, 0);
});

test("같은 완료 결과 저장 재시도는 계정 안에서 중복되지 않는다", async () => {
  const env = setup(), a = await env.account(), another = await env.account(), entry = passwordMetadata();
  await a.client.savePasswordHistory(entry); await another.client.savePasswordHistory(entry); assert.equal(env.passwordRows.length, 1);
});

test("계정별 두 종류 기록만 삭제하고 다른 계정은 보존한다", async () => {
  const env = setup(), a = await env.account(), b = await env.account("synthetic-google-b"), entry = passwordMetadata();
  for (const { client } of [a, b]) { await client.scan(input); await client.savePasswordHistory(entry); }
  await a.client.clearHistory();
  assert.equal((await a.client.history()).rows.length, 0); assert.equal((await b.client.history()).rows.length, 2);
});

test("삭제 확인이 없으면 내 기록도 지우지 않는다", async () => {
  const env = setup(), a = await env.account(); await a.client.scan(input);
  assert.equal((await a.request("/api/security/history", { method: "DELETE", body: JSON.stringify({ confirm: false }) })).status, 400);
  assert.equal(env.rows.length, 1);
});

test("비밀정보가 섞인 객체도 저장 요청은 허용한 네 필드만 전송한다", async () => {
  const env = setup(), a = await env.account(); let payload;
  const client = createSecurityClient(async (path, init) => { payload = JSON.parse(init.body); return (await a.request(path, init)).json(); });
  await client.savePasswordHistory({ ...passwordMetadata(), password: "가상 비밀정보", hash: "a".repeat(40), prefix: "AAAAA", email: sampleEmail });
  assert.deepEqual(Object.keys(payload).sort(), ["checked_at", "count", "id", "status"]);
});

for (const [name, changes] of [
  ["원문 필드", { password: "가상 비밀정보" }], ["전체 해시", { hash: "a".repeat(40) }], ["해시 일부", { prefix: "ABCDE" }], ["이메일", { email: sampleEmail }],
  ["오류 결과", { status: "network_error" }], ["미발견과 횟수 불일치", { status: "not_found", count: 5 }], ["발견과 횟수 불일치", { status: "found", count: 0 }],
  ["음수 횟수", { count: -1 }], ["소수 횟수", { count: 1.5 }], ["문자열 횟수", { count: "12" }], ["과도한 횟수", { count: Number.MAX_SAFE_INTEGER + 1 }],
  ["임의 식별값", { id: "a".repeat(40) }], ["잘못된 시각", { checked_at: "not a date" }], ["먼 미래 시각", { checked_at: "2099-01-01T00:00:00.000Z" }],
  ["만료된 시각", { checked_at: new Date(Date.now() - 31 * 864e5).toISOString() }],
]) test(`비밀번호 이력은 ${name}를 거절하고 저장하지 않는다`, async () => {
  const env = setup(), a = await env.account();
  const response = await a.request("/api/security/history/password", { method: "POST", body: JSON.stringify(passwordMetadata(changes)) });
  assert.equal(response.status, 400); assert.equal(env.passwordRows.length, 0);
  const text = await response.text(); assert.ok(!text.includes("가상 비밀정보")); assert.ok(!text.includes(sampleEmail));
});

test("잘못된 형식·초과 크기의 비밀번호 기록은 저장하지 않는다", async () => {
  const env = setup(), a = await env.account();
  for (const body of ["null", "[]", "{", JSON.stringify({ padding: "x".repeat(2000) })]) assert.equal((await a.request("/api/security/history/password", { method: "POST", body })).status, 400);
  assert.equal((await a.request("/api/security/history/password", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(passwordMetadata()) })).status, 400);
  assert.equal(env.passwordRows.length, 0);
});

test("두 종류 합산 최신 100개·최근 30일로 제한하고 계정 기록만 정리한다", async () => {
  const env = setup(), { client } = await env.account();
  await client.scan(input); await client.savePasswordHistory(passwordMetadata());
  const owner = env.passwordRows[0].owner_key, insert = env.sqlite.prepare("INSERT INTO security_password_history VALUES (?, ?, ?, ?, ?, ?)");
  for (let i = 0; i < 105; i++) { const time = new Date(Date.now() - i * 1000 - 1000).toISOString(); insert.run(randomUUID(), owner, "not_found", 0, time, time); }
  const old = new Date(Date.now() - 31 * 864e5).toISOString(); insert.run(randomUUID(), owner, "not_found", 0, old, old);
  const { rows } = await client.history(); assert.equal(rows.length, 100);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].created_at >= rows[i].created_at);
  assert.equal(env.passwordRows.filter(row => row.created_at === old).length, 0);
});

test("비밀번호 이력 저장 실패를 성공으로 표시하지 않는다", async () => {
  const env = setup(), { client } = await env.account();
  env.sqlite.exec("CREATE TRIGGER password_save_failure BEFORE INSERT ON security_password_history BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  const warn = console.warn, logs = []; console.warn = value => logs.push(value);
  try { await assert.rejects(client.savePasswordHistory(passwordMetadata())); assert.ok(logs.some(log => log.includes("password_history_save_failed"))); assert.ok(logs.every(log => !log.includes(sampleEmail))); }
  finally { console.warn = warn; }
});

test("스키마 재적용은 계정 기록과 로그인 연결을 보존한다", async () => {
  const env = setup(), { client } = await env.account(); await client.scan(input); await client.savePasswordHistory(passwordMetadata());
  env.sqlite.exec(schema); assert.equal((await client.history()).rows.length, 2);
});
