import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { randomBytes } from "node:crypto";

const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith(".") && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return next(candidate.href, context);
  }
  return next(specifier, context);
} });
const { googleApi, securityApi, googleSessionKey, rememberGoogleSession, forgetGoogleSession, resetGoogleSessionMemory, GOOGLE_SESSION_STORAGE, GOOGLE_SESSION_INVALID } = await import("../src/security/google-session.ts");
hook.deregister();
const random = () => randomBytes(32).toString("base64url");
const ttl = 72 * 60 * 60_000;

function storage() {
  const map = new Map();
  return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
}
function fixture(t) {
  const browser = Object.assign(new EventTarget(), { localStorage: storage(), sessionStorage: storage() });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: browser, configurable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window; });
  resetGoogleSessionMemory();
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, init) => { calls.push({ path, init }); return Response.json({ rows: [], ok: true }); });
  const key = random(), csrf = random(), expires = new Date(Date.now() + ttl - 1000).toISOString();
  return { browser, calls, key, csrf, expires, remember: () => rememberGoogleSession(key, expires, csrf) };
}

test("브라우저 재실행을 재현해도 무작위 앱 키와 72시간 만료 시각만 복구한다", t => {
  const f = fixture(t); f.remember(); resetGoogleSessionMemory();
  assert.equal(googleSessionKey(), f.key);
  const saved = JSON.parse(f.browser.localStorage.getItem(GOOGLE_SESSION_STORAGE));
  assert.deepEqual(Object.keys(saved).sort(), ["expires", "key"]); assert.equal(saved.expires, Date.parse(f.expires));
  assert.equal(f.browser.sessionStorage.map.size, 0);
});

test("Google와 검사 요청에만 연결 키를 보내며 이전 브라우저 구분값을 사용하지 않는다", async t => {
  const f = fixture(t); f.remember(); f.browser.localStorage.setItem("ggsafe.history-browser.v1", "legacy-preserved");
  await googleApi("/api/preview-google/session"); await securityApi("/api/security/history");
  for (const call of f.calls) {
    assert.equal(call.init.headers["x-ggsafe-session"], f.key);
    assert.equal(call.init.headers["x-ggsafe-csrf"], f.csrf);
    assert.equal(new Headers(call.init.headers).has("x-ggsafe-browser"), false);
  }
  await assert.rejects(googleApi("https://api.pwnedpasswords.com/range/ABCDE"));
  await assert.rejects(securityApi("/api/settings")); assert.equal(f.calls.length, 2);
});

test("로그인 키를 지웠다면 남은 쿠키로 조용히 복구하지 않는다", async t => {
  const f = fixture(t); f.remember(); forgetGoogleSession();
  await googleApi("/api/preview-google/session"); assert.equal(f.calls[0].init.headers["x-ggsafe-session"], "");
  await assert.rejects(securityApi("/api/security/history")); assert.equal(f.calls.length, 1);
});

test("만료되거나 형식이 잘못된 저장값을 검사 요청에 싣지 않는다", async t => {
  const f = fixture(t);
  for (const saved of [{ key: f.key, expires: Date.now() - 1 }, { key: "bad", expires: Date.now() + ttl }, { key: f.key, expires: Date.now() + ttl * 2 }]) {
    resetGoogleSessionMemory(); f.browser.localStorage.setItem(GOOGLE_SESSION_STORAGE, JSON.stringify(saved));
    assert.equal(googleSessionKey(), null); await assert.rejects(securityApi("/api/security/history"));
  }
  assert.equal(f.calls.length, 0);
});

test("저장이 차단돼도 현재 화면에서는 연결하며 다시 열면 재로그인이 필요하다", t => {
  const f = fixture(t);
  for (const method of ["getItem", "setItem", "removeItem"]) t.mock.method(f.browser.localStorage, method, () => { throw new Error("blocked"); });
  f.remember(); assert.equal(googleSessionKey(), f.key); resetGoogleSessionMemory(); assert.equal(googleSessionKey(), null);
});

test("로그아웃은 앱 연결만 지우고 기존 브라우저 이력 구분값은 보존한다", t => {
  const f = fixture(t); f.remember(); f.browser.localStorage.setItem("ggsafe.history-browser.v1", "legacy-preserved");
  forgetGoogleSession(); assert.equal(googleSessionKey(), null);
  assert.equal(f.browser.localStorage.getItem("ggsafe.history-browser.v1"), "legacy-preserved");
});

test("계정 변경 전 작업은 새 계정 연결을 사용하지 못한다", async t => {
  const f = fixture(t); f.remember();
  rememberGoogleSession(random(), f.expires, random());
  await assert.rejects(securityApi("/api/security/history/password", { method: "POST", body: "{}" }, f.key), /계정/);
  assert.equal(f.calls.length, 0);
});

test("이전 계정의 늦은 401 응답이 새 계정을 로그아웃시키지 않는다", async t => {
  const f = fixture(t); f.remember();
  let release;
  t.mock.method(globalThis, "fetch", () => new Promise(resolve => { release = resolve; }));
  const request = securityApi("/api/security/history");
  const next = random(); rememberGoogleSession(next, f.expires, random());
  release(Response.json({ error: "expired" }, { status: 401 }));
  await assert.rejects(request); assert.equal(googleSessionKey(), next);
});

test("현재 연결의 401 응답은 키를 지우고 즉시 화면 잠금 알림을 보낸다", async t => {
  const f = fixture(t); f.remember(); let locked = 0;
  f.browser.addEventListener(GOOGLE_SESSION_INVALID, () => { locked++; });
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "expired" }, { status: 401 }));
  await assert.rejects(securityApi("/api/security/history"));
  assert.equal(locked, 1); assert.equal(googleSessionKey(), null);
});

test("성공 응답을 기다리는 중 만료되면 결과 대신 화면 잠금 알림을 보낸다", async t => {
  const f = fixture(t); f.remember(); let release, locked = 0;
  f.browser.addEventListener(GOOGLE_SESSION_INVALID, () => { locked++; });
  t.mock.method(globalThis, "fetch", () => new Promise(resolve => { release = resolve; }));
  const request = securityApi("/api/security/history");
  f.browser.localStorage.setItem(GOOGLE_SESSION_STORAGE, JSON.stringify({ key: f.key, expires: Date.now() - 1 }));
  release(Response.json({ rows: [{ id: "synthetic-only" }] }));
  await assert.rejects(request, /로그인 상태/);
  assert.equal(locked, 1); assert.equal(googleSessionKey(), null);
});

test("이전 계정의 늦은 성공 응답도 새 계정에 반환하지 않는다", async t => {
  const f = fixture(t); f.remember(); let release;
  t.mock.method(globalThis, "fetch", () => new Promise(resolve => { release = resolve; }));
  const request = securityApi("/api/security/history");
  const next = random(); rememberGoogleSession(next, f.expires, random());
  release(Response.json({ rows: [{ id: "previous-account-only" }] }));
  await assert.rejects(request, /로그인 상태/); assert.equal(googleSessionKey(), next);
});
