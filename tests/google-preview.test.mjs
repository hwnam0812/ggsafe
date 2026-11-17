import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { createGooglePreview, GOOGLE_CLIENT_ID, GOOGLE_PREVIEW_PATH as base, previewOrigin, verifyGoogleIdentity, SESSION_TTL } from "../scripts/google-preview.mjs";
import { memoryGoogleSessions } from "../scripts/google-session-store.mjs";

// 모든 계정·서명·비밀값은 테스트에서 만든 가상 값입니다. 실제 환경의 비밀키를 읽지 않습니다.
const [{ privateKey, publicKey }, otherKeys] = await Promise.all([generateKeyPair("RS256"), generateKeyPair("RS256")]);
const sha256 = value => createHash("sha256").update(value).digest("hex");
const proof = () => randomBytes(32).toString("hex");
const pair = response => response.headers.get("set-cookie")?.[0]?.split(";")[0] ?? "";

async function call(handler, path, { method = "GET", body, cookie = "", headers = {} } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))]);
  Object.assign(req, { method, url: `${base}${path}`, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), cookie, ...headers } });
  const result = { status: 200, headers: new Map(), text: "", next: false };
  const res = {
    statusCode: 200,
    getHeader: name => result.headers.get(name.toLowerCase()),
    setHeader: (name, value) => result.headers.set(name.toLowerCase(), value),
    end(value = "") { result.status = this.statusCode; result.text = value; }
  };
  await handler(req, res, () => { result.next = true; });
  result.json = () => JSON.parse(result.text);
  return result;
}

function signedIdentity(nonce, claims = {}, key = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: "https://accounts.google.com", aud: GOOGLE_CLIENT_ID, sub: "test-google-subject", email: "preview-test@example.com", email_verified: true, nonce, iat: now, exp: now + 3600, ...claims })
    .setProtectedHeader({ alg: "RS256" }).sign(key);
}

function fixture(options = {}) {
  let clock = Date.now();
  const store = options.store ?? memoryGoogleSessions();
  const state = { nonce: "", email: "preview-test@example.com", tokenCalls: 0, exchange: null, pkce: "" };
  const handler = createGooglePreview({
    getSecret: () => "synthetic-unit-test-secret",
    keys: publicKey,
    now: () => clock,
    store,
    fetchImpl: async (url, init) => {
      state.tokenCalls++;
      assert.equal(url, "https://oauth2.googleapis.com/token");
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      assert.equal(init.body.get("client_secret"), "synthetic-unit-test-secret");
      assert.equal(createHash("sha256").update(init.body.get("code_verifier")).digest("base64url"), state.pkce);
      if (state.exchange) return state.exchange(url, init);
      return Response.json({ id_token: await signedIdentity(state.nonce, { email: state.email }), access_token: "synthetic-test-access-token" });
    },
    ...options
  });
  const request = (path, init) => call(handler, path, init);
  async function prepare(origin = "http://localhost:5173") {
    const verifier = proof();
    const response = await request("/prepare", { method: "POST", body: { origin, challenge: sha256(verifier) } });
    assert.equal(response.status, 200);
    return { ...response.json(), verifier, origin };
  }
  async function start(origin) {
    const flow = await prepare(origin);
    const response = await request(`/start?flow=${flow.flow_id}`);
    assert.equal(response.status, 303);
    const authorization = new URL(response.headers.get("location"));
    state.nonce = authorization.searchParams.get("nonce");
    state.pkce = authorization.searchParams.get("code_challenge");
    return { ...flow, authorization, cookie: pair(response), startResponse: response };
  }
  const finish = (flow, cookie = "") => request("/finish", { method: "POST", cookie, body: { flow_id: flow.flow_id, verifier: flow.verifier } });
  const callback = (flow, { cookie = flow.cookie, query = {} } = {}) => request(`/callback?${new URLSearchParams({ state: flow.authorization.searchParams.get("state"), code: "synthetic-test-code", ...query })}`, { cookie });
  async function connect(cookie = "", origin) {
    const flow = await start(origin);
    assert.equal((await callback(flow)).status, 303);
    const response = await finish(flow, cookie);
    assert.equal(response.json().state, "complete");
    return response;
  }
  return { request, prepare, start, finish, callback, connect, state, store, advance: milliseconds => { clock += milliseconds; } };
}

test("미리보기와 로컬 주소만 돌아올 주소로 허용해요", () => {
  for (const value of ["http://localhost:5173", "http://127.0.0.1:5173", "https://5173-preview.e2b.app", "https://preview.baze.cloud"]) assert.equal(previewOrigin(value), value);
  for (const value of ["https://example.com", "http://preview.e2b.app", "https://preview.e2b.app.evil.invalid", "https://user:pass@preview.e2b.app", "https://preview.e2b.app/", "https://preview.e2b.app/path", "null", null]) assert.throws(() => previewOrigin(value));
});

async function identityFlow(f) {
  const verifier = proof();
  const response = await f.request("/prepare", { method: "POST", body: { origin: "https://preview.baze.cloud", challenge: sha256(verifier), mode: "identity" } });
  assert.equal(response.status, 200);
  return { ...response.json(), verifier };
}

async function identityResponse(f, flow, changes = {}) {
  return f.request("/identity", { method: "POST", body: {
    flow_id: flow.flow_id, verifier: flow.verifier, state: flow.state,
    credential: await signedIdentity(flow.nonce), ...changes,
  } });
}

test("공식 팝업 로그인을 준비할 때 새 미리보기 주소나 비밀키를 전달하지 않아요", async () => {
  const f = fixture();
  const flow = await identityFlow(f);
  assert.equal(flow.client_id, GOOGLE_CLIENT_ID);
  assert.match(flow.nonce, /^[\w-]{43}$/);
  assert.match(flow.state, /^[\w-]{43}$/);
  assert.equal(flow.start_url, undefined);
  assert.equal(flow.client_secret, undefined);
  assert.equal((await f.request(`/start?flow=${flow.flow_id}`)).status, 400);
});

test("공식 팝업의 서명·nonce를 검증한 후 같은 화면에서 연결을 마쳐요", async () => {
  const f = fixture();
  const flow = await identityFlow(f);
  const response = await identityResponse(f, flow);
  assert.deepEqual(response.json(), { ok: true });
  assert.equal(f.state.tokenCalls, 0);
  const completed = await f.finish(flow);
  assert.equal(completed.json().state, "complete");
  assert.deepEqual(completed.json().session.user, { email: "preview-test@example.com" });
  assert.equal(completed.text.includes("credential"), false);
  assert.match(completed.headers.get("set-cookie")[0], /Secure; Partitioned/);
  assert.equal((await f.request("/session", { cookie: pair(completed) })).json().user.email, "preview-test@example.com");
});

test("공식 팝업의 다른 증명값이나 state로 연결하지 못해요", async () => {
  const f = fixture();
  const flow = await identityFlow(f);
  for (const changes of [{ verifier: proof() }, { verifier: "" }, { state: "wrong" }, { state: undefined }]) {
    assert.equal((await identityResponse(f, flow, changes)).status, 400);
  }
  assert.equal((await identityResponse(f, flow)).status, 200);
});

async function headerSession(f, headers = {}) {
  const flow = await identityFlow(f);
  assert.equal((await identityResponse(f, flow)).status, 200);
  const key = randomBytes(32).toString("base64url");
  const response = await f.request("/finish", { method: "POST", headers, body: { flow_id: flow.flow_id, verifier: flow.verifier, session_key: key } });
  assert.equal(response.json().state, "complete");
  return { key, response, headers: { "x-ggsafe-session": key } };
}

test("쿠키가 전혀 전달되지 않아도 앱의 별도 연결 키로 상태를 확인해요", async () => {
  const f = fixture();
  const connected = await headerSession(f);
  assert.equal((await f.request("/session")).json().user, null);
  assert.equal((await f.request("/session", { headers: connected.headers })).json().user.email, "preview-test@example.com");
  assert.equal(connected.response.text.includes(connected.key), false);
});

test("잘못된 연결 키·쿠키·주소 매개변수로 연결을 가져오지 못해요", async () => {
  const f = fixture();
  const connected = await headerSession(f);
  for (const key of ["", "invalid", randomBytes(32).toString("base64url")]) {
    assert.equal((await f.request("/session", { headers: { "x-ggsafe-session": key }, cookie: pair(connected.response) })).json().user, null);
  }
  assert.equal((await f.request(`/session?session_key=${connected.key}`)).json().user, null);
});

test("연결 키가 있어도 검증된 Google 로그인 없이는 연결을 만들지 못해요", async () => {
  const f = fixture();
  const flow = await identityFlow(f);
  const key = randomBytes(32).toString("base64url");
  const response = await f.request("/finish", { method: "POST", body: { flow_id: flow.flow_id, verifier: flow.verifier, session_key: key } });
  assert.equal(response.json().state, "pending");
  assert.equal((await f.request("/session", { headers: { "x-ggsafe-session": key } })).json().user, null);
});

test("쿠키 없이 연결을 해제할 때도 확인값이 필요하고 기존 키는 폐기돼요", async () => {
  const f = fixture();
  const connected = await headerSession(f);
  assert.equal((await f.request("/logout", { method: "POST", headers: connected.headers, body: {} })).status, 403);
  assert.equal((await f.request("/logout", { method: "POST", headers: { ...connected.headers, "x-ggsafe-csrf": connected.response.json().session.csrf }, body: {} })).status, 200);
  assert.equal((await f.request("/session", { headers: connected.headers })).json().user, null);
});

test("쿠키 없이 계정을 전환해도 이전 연결 키는 재사용할 수 없어요", async () => {
  const f = fixture();
  const first = await headerSession(f);
  const second = await headerSession(f, first.headers);
  assert.equal((await f.request("/session", { headers: first.headers })).json().user, null);
  assert.ok((await f.request("/session", { headers: second.headers })).json().user);
});

test("별도 연결 키는 72시간 후 만료되고 서로 다른 저장소와 격리돼요", async () => {
  const f = fixture();
  const connected = await headerSession(f);
  assert.equal((await fixture().request("/session", { headers: connected.headers })).json().user, null);
  f.advance(SESSION_TTL + 1);
  assert.equal((await f.request("/session", { headers: connected.headers })).json().user, null);
});

test("잘못되거나 이미 사용 중인 연결 키를 새 연결에 지정하지 못해요", async () => {
  const f = fixture();
  const previous = await headerSession(f);
  const flow = await identityFlow(f);
  await identityResponse(f, flow);
  for (const key of [null, "short", [previous.key], previous.key]) {
    const response = await f.request("/finish", { method: "POST", body: { flow_id: flow.flow_id, verifier: flow.verifier, session_key: key } });
    assert.equal(response.status, 400);
  }
  assert.equal((await f.finish(flow)).json().state, "complete");
});

for (const invalid of ["서명", "nonce", "이메일 확인"]) {
  test(`공식 팝업의 ${invalid} 검증 실패를 로그인 성공으로 처리하지 않아요`, async () => {
    const f = fixture();
    const flow = await identityFlow(f);
    const credential = await signedIdentity(invalid === "nonce" ? "wrong" : flow.nonce,
      invalid === "이메일 확인" ? { email_verified: false } : {}, invalid === "서명" ? otherKeys.privateKey : privateKey);
    const response = await identityResponse(f, flow, { credential });
    assert.equal(response.status, 401);
    assert.equal(response.text.includes(credential), false);
    assert.equal((await f.finish(flow)).json().state, "error");
    assert.equal((await f.request("/session")).json().user, null);
  });
}

test("공식 팝업의 같은 결과를 두 번 사용하거나 취소 후 연결하지 못해요", async () => {
  const f = fixture();
  const flow = await identityFlow(f);
  assert.equal((await identityResponse(f, flow)).status, 200);
  assert.equal((await identityResponse(f, flow)).status, 400);
  assert.equal((await f.finish(flow)).json().state, "complete");
  assert.equal((await f.finish(flow)).status, 400);
  const cancelled = await identityFlow(f);
  await f.request("/cancel", { method: "POST", body: { flow_id: cancelled.flow_id, verifier: cancelled.verifier } });
  assert.equal((await identityResponse(f, cancelled)).status, 400);
});

test("공식 팝업도 10분 뒤 만료되고 다른 로그인 방식과 섞이지 않아요", async () => {
  const f = fixture();
  const flow = await identityFlow(f);
  f.advance(10 * 60_000 + 1);
  assert.equal((await identityResponse(f, flow)).status, 400);
  const redirected = await f.prepare();
  assert.equal((await identityResponse(f, { ...redirected, nonce: "unused", state: "unused" })).status, 400);
});

test("공식 팝업의 잘못된 토큰 형식과 과도한 크기를 차단해요", async () => {
  const f = fixture();
  const flow = await identityFlow(f);
  for (const credential of [null, "", "x".repeat(16385)]) {
    assert.equal((await identityResponse(f, flow, { credential })).status, 400);
  }
  assert.equal((await f.request("/identity", { method: "POST", body: "x".repeat(20 * 1024 + 1) })).status, 400);
});

test("비밀키가 없으면 연결을 시작하지 않아요", async () => {
  const f = fixture({ getSecret: () => "" });
  const response = await f.request("/session");
  assert.deepEqual(response.json(), { available: false, preview_only: true, user: null, csrf: null, connection_id: null, expires_at: null });
  assert.equal((await f.request("/prepare", { method: "POST", body: {} })).status, 400);
});

test("잘못된 형식과 너무 큰 연결 요청을 차단해요", async () => {
  const f = fixture();
  for (const init of [
    { body: "{}", headers: { "content-type": "text/plain" } },
    { body: "not-json" }, { body: [] }, { body: null }, { body: "x".repeat(4097) },
    { body: { origin: "https://evil.invalid", challenge: "a".repeat(64) } },
    { body: { origin: "http://localhost:5173", challenge: "incorrect" } }
  ]) assert.equal((await f.request("/prepare", { method: "POST", ...init })).status, 400);
});

test("Google 요청에 state·nonce·PKCE와 최소 권한만 포함해요", async () => {
  const f = fixture();
  const flow = await f.start();
  const params = flow.authorization.searchParams;
  assert.equal(flow.authorization.origin, "https://accounts.google.com");
  assert.equal(params.get("client_id"), GOOGLE_CLIENT_ID);
  assert.equal(params.get("scope"), "openid email");
  assert.equal(params.get("response_type"), "code");
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.equal(params.get("redirect_uri"), `${flow.origin}${base}/callback`);
  assert.match(params.get("state"), /^[\w-]{43}$/);
  assert.match(params.get("nonce"), /^[\w-]{43}$/);
  assert.equal(params.has("client_secret"), false);
  assert.equal(params.has("access_type"), false);
  assert.equal((await f.request(`/start?flow=${flow.flow_id}`)).status, 400);
});

test("화면의 64자리 일회용 확인값으로 완료 확인과 취소가 돼요", async () => {
  const f = fixture();
  const flow = await f.prepare();
  assert.equal((await f.finish(flow)).json().state, "pending");
  assert.equal((await f.request("/cancel", { method: "POST", body: { flow_id: flow.flow_id, verifier: flow.verifier } })).json().ok, true);
  assert.equal((await f.finish(flow)).status, 400);
});

test("다른 확인값으로 연결을 가져오거나 취소하지 못해요", async () => {
  const f = fixture();
  const flow = await f.prepare();
  for (const path of ["/finish", "/cancel"]) assert.equal((await f.request(path, { method: "POST", body: { flow_id: flow.flow_id, verifier: proof() } })).status, 400);
  assert.equal((await f.finish(flow)).json().state, "pending");
});

test("알 수 없는 state와 브라우저 확인 쿠키 없는 응답을 차단해요", async () => {
  const f = fixture();
  const flow = await f.start();
  assert.equal((await f.callback(flow, { query: { state: "unknown-state" } })).status, 400);
  assert.equal((await f.callback(flow, { cookie: "" })).status, 400);
  assert.equal((await f.callback(flow, { cookie: "ggsafe_oauth_wrong=wrong" })).status, 400);
  assert.equal(f.state.tokenCalls, 0);
  assert.equal((await f.callback(flow)).status, 303);
  assert.equal((await f.callback(flow)).status, 400);
  assert.equal(f.state.tokenCalls, 1);
});

test("사용자가 Google 승인을 취소하면 로그인하지 않아요", async () => {
  const f = fixture();
  const flow = await f.start();
  assert.equal((await f.callback(flow, { query: { error: "access_denied" } })).status, 303);
  const response = await f.finish(flow);
  assert.equal(response.json().state, "error");
  assert.match(response.json().message, /취소/);
  assert.equal(pair(response), "");
  assert.equal(f.state.tokenCalls, 0);
});

test("다른 발급처의 콜백은 Google로 교환하지 않아요", async () => {
  const f = fixture();
  const flow = await f.start();
  await f.callback(flow, { query: { iss: "https://evil.invalid" } });
  assert.equal((await f.finish(flow)).json().state, "error");
  assert.equal(f.state.tokenCalls, 0);
});

test("검증된 이메일만 연결하고 Google 토큰은 화면에 반환하지 않아요", async () => {
  const f = fixture();
  const response = await f.connect();
  const data = response.json();
  assert.deepEqual(data.session.user, { email: "preview-test@example.com" });
  assert.equal(data.session.preview_only, true);
  assert.ok(data.session.csrf);
  assert.ok(data.session.connection_id);
  assert.ok(!response.text.includes("id_token") && !response.text.includes("access_token") && !response.text.includes("synthetic-unit-test-secret"));
  assert.match(response.headers.get("set-cookie")[0], /HttpOnly/);
  assert.match(response.headers.get("set-cookie")[0], /SameSite=Lax/);
  assert.match(response.headers.get("set-cookie")[0], /Max-Age=259200/);
  assert.deepEqual((await f.request("/session", { cookie: pair(response) })).json().user, data.session.user);
  assert.equal((await f.request("/session")).json().user, null);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
});

test("HTTPS 미리보기 연결에는 분리된 보안 쿠키를 사용해요", async () => {
  const f = fixture();
  const response = await f.connect("", "https://preview.baze.cloud");
  const cookie = response.headers.get("set-cookie")[0];
  for (const flag of ["HttpOnly", "Secure", "SameSite=None", "Partitioned", `Path=${base}`]) assert.ok(cookie.includes(flag));
});

test("검증된 이메일과 서버에서만 사용할 Google 고유 식별자를 추출해요", async () => {
  const token = await signedIdentity("nonce-test");
  assert.deepEqual(await verifyGoogleIdentity(token, "nonce-test", publicKey), { email: "preview-test@example.com", subject: "test-google-subject" });
});

for (const [name, claims] of [
  ["다른 발급처", { iss: "https://evil.invalid" }],
  ["다른 클라이언트", { aud: "another-client" }],
  ["다른 승인 대상", { azp: "another-client" }],
  ["다중 승인 대상의 azp 누락", { aud: [GOOGLE_CLIENT_ID, "another-client"] }],
  ["다른 nonce", { nonce: "another-nonce" }],
  ["이메일 미확인", { email_verified: false }],
  ["문자열 이메일 확인값", { email_verified: "true" }],
  ["이메일 누락", { email: undefined }],
  ["이메일 형식 오류", { email: "not-email" }],
  ["계정 구분값 누락", { sub: undefined }],
  ["만료된 토큰", { exp: Math.floor(Date.now() / 1000) - 60 }],
  ["오래된 발급 시각", { iat: Math.floor(Date.now() / 1000) - 700 }],
  ["미래 발급 시각", { iat: Math.floor(Date.now() / 1000) + 100 }]
]) test(`신원 확인 실패: ${name}`, async () => {
  await assert.rejects(verifyGoogleIdentity(await signedIdentity("nonce-test", claims), "nonce-test", publicKey));
});

test("다른 서명 키로 만든 토큰을 차단해요", async () => {
  await assert.rejects(verifyGoogleIdentity(await signedIdentity("nonce-test", {}, otherKeys.privateKey), "nonce-test", publicKey));
});

test("토큰 교환 실패를 로그인으로 처리하지 않고 원본 오류를 숨겨요", async () => {
  const f = fixture();
  f.state.exchange = async () => Response.json({ error: "synthetic-private-response" }, { status: 400 });
  const flow = await f.start();
  await f.callback(flow);
  const response = await f.finish(flow);
  assert.equal(response.json().state, "error");
  assert.equal(response.text.includes("synthetic-private-response"), false);
  assert.equal(pair(response), "");
});

test("연결 해제에는 현재 브라우저의 확인값이 필요해요", async () => {
  const f = fixture();
  const response = await f.connect();
  const cookie = pair(response);
  const csrf = response.json().session.csrf;
  for (const value of ["", "incorrect"]) assert.equal((await f.request("/logout", { method: "POST", cookie, body: {}, headers: { "x-ggsafe-csrf": value } })).status, 403);
  assert.ok((await f.request("/session", { cookie })).json().user);
  const logout = await f.request("/logout", { method: "POST", cookie, body: {}, headers: { "x-ggsafe-csrf": csrf } });
  assert.equal(logout.json().user, null);
  assert.match(logout.headers.get("set-cookie")[0], /Max-Age=0/);
  assert.equal((await f.request("/session", { cookie })).json().user, null);
});

test("계정을 바꾸면 이전 연결을 폐기해요", async () => {
  const f = fixture();
  const first = await f.connect();
  f.state.email = "another-preview-test@example.com";
  const second = await f.connect(pair(first));
  assert.notEqual(first.json().session.connection_id, second.json().session.connection_id);
  assert.equal(second.json().session.user.email, f.state.email);
  assert.equal((await f.request("/session", { cookie: pair(first) })).json().user, null);
  assert.equal((await f.request("/session", { cookie: pair(second) })).json().user.email, f.state.email);
});

test("로그인 대기는 10분, 실제 이용이 없는 연결은 72시간 뒤 만료돼요", async () => {
  const f = fixture();
  const flow = await f.start();
  f.advance(10 * 60_000 + 1);
  assert.equal((await f.callback(flow)).status, 400);
  assert.equal((await f.finish(flow)).status, 400);
  const response = await f.connect();
  f.advance(SESSION_TTL + 1);
  assert.equal((await f.request("/session", { cookie: pair(response) })).json().user, null);
});

test("다음 요청이 없어도 만료된 연결을 메모리에서 지워요", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  const flow = await f.prepare();
  t.mock.timers.tick(10 * 60_000 + 1);
  assert.equal((await f.finish(flow)).status, 400);
  const response = await f.connect();
  t.mock.timers.tick(SESSION_TTL + 1);
  // 이 테스트의 now 값은 그대로이므로 요청 시 정리가 아닌 만료 타이머를 확인해요.
  assert.equal((await f.request("/session", { cookie: pair(response) })).json().user, null);
});

test("교환 도중 취소한 요청으로 연결을 만들지 못해요", async () => {
  const f = fixture();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.state.exchange = async () => { entered(); await held; return Response.json({ id_token: await signedIdentity(f.state.nonce) }); };
  const flow = await f.start();
  const callback = f.callback(flow);
  await started;
  assert.equal((await f.finish(flow)).json().state, "pending");
  await f.request("/cancel", { method: "POST", body: { flow_id: flow.flow_id, verifier: flow.verifier } });
  release();
  await callback;
  assert.equal((await f.finish(flow)).status, 400);
  assert.equal((await f.request("/session")).json().user, null);
});

test("요청이 과하게 쌓이면 추가 연결을 제한해요", async () => {
  const f = fixture();
  for (let index = 0; index < 100; index++) await f.prepare();
  const response = await f.request("/prepare", { method: "POST", body: { origin: "http://localhost:5173", challenge: sha256(proof()) } });
  assert.equal(response.status, 429);
});

test("연결 결과 화면에 코드·이메일을 넣지 않고 외부 삽입을 막아요", async () => {
  const f = fixture();
  const response = await f.request("/result");
  assert.match(response.text, /lang="ko"/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.text.includes("preview-test@example.com"), false);
});

test("자동 상태 조회만으로는 72시간 기한이 연장되지 않아요", async () => {
  const f = fixture(), connected = await headerSession(f);
  const expires = connected.response.json().session.expires_at;
  f.advance(48 * 60 * 60_000);
  assert.equal((await f.request("/session", { headers: connected.headers })).json().expires_at, expires);
  f.advance(24 * 60 * 60_000);
  assert.equal((await f.request("/session", { headers: connected.headers })).json().user, null);
});

test("만료 전에 실제로 이용하면 그 이용 시점부터 다시 72시간으로 연장돼요", async () => {
  const f = fixture(), connected = await headerSession(f);
  const initial = Date.parse(connected.response.json().session.expires_at);
  f.advance(48 * 60 * 60_000);
  const headers = { ...connected.headers, "x-ggsafe-csrf": connected.response.json().session.csrf };
  const active = await f.request("/activity", { method: "POST", headers, body: {} });
  assert.equal(active.status, 200);
  assert.equal(Date.parse(active.json().expires_at), initial + 48 * 60 * 60_000);
  f.advance(25 * 60 * 60_000);
  assert.ok((await f.request("/session", { headers })).json().user);
  f.advance(47 * 60 * 60_000);
  assert.equal((await f.request("/session", { headers })).json().user, null);
});

test("확인값 없는 연장과 만료 후 되살리기를 막아요", async () => {
  const f = fixture(), connected = await headerSession(f);
  assert.equal((await f.request("/activity", { method: "POST", headers: connected.headers, body: {} })).status, 403);
  const headers = { ...connected.headers, "x-ggsafe-csrf": connected.response.json().session.csrf };
  f.advance(SESSION_TTL);
  assert.equal((await f.request("/activity", { method: "POST", headers, body: {} })).status, 401);
  assert.equal((await f.request("/session", { headers })).json().user, null);
});

test("공유 저장소로 처리기를 다시 열어도 같은 앱 키로 복구해요", async () => {
  const store = memoryGoogleSessions(), f = fixture({ store }), connected = await headerSession(f);
  const restored = await fixture({ store }).request("/session", { headers: connected.headers });
  assert.deepEqual(restored.json().user, { email: "preview-test@example.com" });
  assert.equal(restored.json().connection_id, connected.response.json().session.connection_id);
});

test("로그인 복구 정보는 암호화하고 Google 토큰·고유 식별자·앱 키는 저장하지 않아요", async () => {
  const f = fixture(), connected = await headerSession(f);
  const row = await f.store.get(sha256(connected.key), Date.now());
  const text = JSON.stringify(row);
  for (const value of ["preview-test@example.com", "test-google-subject", connected.key, connected.response.json().session.csrf, "synthetic-unit-test-secret"]) assert.ok(!text.includes(value));
  assert.match(row.owner_key, /^google:v1:[a-f0-9]{64}$/);
  assert.equal(row.email_hash, sha256("preview-test@example.com"));
});

test("다른 보호 키나 변조된 복구 정보는 로그인으로 표시하지 않아요", async () => {
  const store = memoryGoogleSessions(), f = fixture({ store }), connected = await headerSession(f);
  const other = fixture({ store, getSecret: () => "another-synthetic-secret" });
  assert.equal((await other.request("/session", { headers: connected.headers })).json().user, null);
  const id = sha256(connected.key), row = await store.get(id, Date.now());
  await store.remove(id); await store.insert(id, { ...row, private_json: row.private_json.slice(0, -8) + "tampered" });
  assert.equal((await f.request("/session", { headers: connected.headers })).json().user, null);
});

test("연장 전에 예약한 만료 작업이 새 기한의 연결을 지우지 않아요", async () => {
  const store = memoryGoogleSessions(), f = fixture({ store }), connected = await headerSession(f);
  const id = sha256(connected.key), old = await store.get(id, Date.now());
  await store.touch(id, Date.now(), old.expires_at + 1000);
  await store.remove(id, old.expires_at);
  assert.ok(await store.get(id, Date.now()));
});

test("지연된 이용 알림은 실제 조작 시각으로만 연장하고 과거·미래 조작값은 거절해요", async () => {
  let clock = Date.now();
  const f = fixture({ now: () => clock }), connected = await headerSession(f);
  const headers = { ...connected.headers, "x-ggsafe-csrf": connected.response.json().session.csrf };
  clock += 48 * 60 * 60_000;
  const actual = clock - 30_000;
  const response = await f.request("/activity", { method: "POST", headers, body: { at: actual } });
  assert.equal(Date.parse(response.json().expires_at), actual + SESSION_TTL);
  for (const at of [clock - 60_001, clock + 5001, "now", null, 1.5]) {
    if (at === null) continue; // 누락과 null은 현재 조작 요청으로 처리한다.
    assert.equal((await f.request("/activity", { method: "POST", headers, body: { at } })).status, 400);
  }
});
