// 미리보기 전용 Google 연결입니다. 이 모듈은 브라우저·게시용 Worker에 포함하지 않습니다.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { loadEnvFile } from "node:process";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { databaseGoogleSessions, memoryGoogleSessions } from "./google-session-store.mjs";

export const GOOGLE_CLIENT_ID = "962102314156-ekmi9t3cjn20kaajd36icq66gh9mkrf1.apps.googleusercontent.com";
export const GOOGLE_PREVIEW_PATH = "/api/preview-google";
const FLOW_TTL = 10 * 60_000;
export const SESSION_TTL = 72 * 60 * 60_000;
const SESSION_COOKIE = "ggsafe_google_preview";
const random = () => randomBytes(32).toString("base64url");
const hash = value => createHash("sha256").update(value).digest("hex");
const equal = (a, b) => typeof a === "string" && typeof b === "string" && timingSafeEqual(Buffer.from(hash(a), "hex"), Buffer.from(hash(b), "hex"));
const isRandom = value => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const isBrowserProof = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function clientSecret() {
  // 이미 주입된 환경 변수를 우선합니다. 재개된 미리보기에는 보안 환경을 메모리로만 적재합니다.
  if (!process.env.GOOGLE_CLIENT_SECRET) {
    try { loadEnvFile(join(homedir(), ".config/factchat/project.env")); } catch { /* 없는 환경은 연결 불가로 안내합니다. */ }
  }
  return process.env.GOOGLE_CLIENT_SECRET ?? "";
}

export function previewOrigin(value) {
  if (typeof value !== "string" || value.length > 300) throw new Error("Invalid preview address");
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const preview = url.hostname.endsWith(".baze.cloud") || url.hostname.endsWith(".e2b.app");
  if (url.origin !== value || url.username || url.password || (!loopback && !(preview && url.protocol === "https:")) || (loopback && !["http:", "https:"].includes(url.protocol))) {
    throw new Error("Invalid preview address");
  }
  return url.origin;
}

function cookies(req) {
  const values = new Map();
  for (const item of (req.headers.cookie ?? "").split(";")) {
    const at = item.indexOf("=");
    if (at > 0) values.set(item.slice(0, at).trim(), item.slice(at + 1).trim());
  }
  return values;
}

function setCookie(res, name, value, origin, maxAge, session = false) {
  const secure = origin.startsWith("https:");
  const attributes = [`${name}=${value}`, `Path=${GOOGLE_PREVIEW_PATH}`, "HttpOnly", `Max-Age=${maxAge}`];
  // 원래 미리보기 화면에서 세션 쿠키를 발급해 삽입된 화면의 쿠키 제한에 대응합니다.
  attributes.push(secure && session ? "SameSite=None" : "SameSite=Lax");
  if (secure) attributes.push("Secure");
  if (secure && session) attributes.push("Partitioned");
  const previous = res.getHeader("set-cookie") ?? [];
  res.setHeader("set-cookie", [...(Array.isArray(previous) ? previous : [previous]), attributes.join("; ")]);
}

async function jsonBody(req, maximum = 4096) {
  if (!(req.headers["content-type"] ?? "").includes("application/json")) throw new Error("JSON required");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximum) throw new Error("Request too large");
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request");
  return value;
}

async function smallJson(response) {
  if (!response.body) throw new Error("Missing response");
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128 * 1024) { await reader.cancel(); throw new Error("Response too large"); }
      parts.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } finally { reader.releaseLock(); }
}

export async function verifyGoogleIdentity(token, nonce, keys) {
  const { payload } = await jwtVerify(token, keys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: GOOGLE_CLIENT_ID,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "email", "email_verified", "exp", "iat", "nonce"],
    maxTokenAge: "10m", clockTolerance: 10
  });
  if (!equal(payload.nonce, nonce) || payload.email_verified !== true || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255 ||
      typeof payload.email !== "string" || payload.email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(payload.email) ||
      (payload.azp !== undefined && payload.azp !== GOOGLE_CLIENT_ID) ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== GOOGLE_CLIENT_ID)) {
    throw new Error("Invalid Google identity");
  }
  // Google 토큰은 보관하지 않는다. sub는 서버에서 소유자 해시를 만들 때만 쓴다.
  return { email: payload.email, subject: payload.sub };
}

function sendJson(res, value, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader("location", location);
  res.end();
}

function resultPage(res, state = "done", status = 200) {
  const failed = state === "error";
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google 연결 · GGSAFE</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7fb;color:#1d2c43;font:15px/1.8 Pretendard,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",system-ui,sans-serif;word-break:keep-all}main{max-width:380px;margin:24px;padding:32px;border:1px solid #e4eaf3;border-radius:14px;background:white}strong{color:#2865df}h1{font-size:23px;letter-spacing:-.02em}p{color:#63738a}</style><main><strong>GGSAFE</strong><h1>${failed ? "연결을 완료하지 못했어요" : "GGSAFE로 돌아가 주세요"}</h1><p>${failed ? "로그인 요청이 만료됐거나 확인되지 않았어요. 원래 GGSAFE 화면에서 다시 연결해 주세요." : "이 창을 닫고 원래 GGSAFE 화면에서 연결 결과를 확인해 주세요."}</p><p>Google 비밀번호는 GGSAFE에 전달되지 않아요.</p></main></html>`);
}

/** Node 미리보기 전용. Google 신원 검증 후 앱 연결만 발급한다. */
export function createGooglePreview({ getSecret = clientSecret, fetchImpl = fetch, keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")), now = Date.now, store = memoryGoogleSessions() } = {}) {
  const flows = new Map();
  const states = new Map();
  const sessionTimers = new Map();

  function privateKey() {
    const secret = getSecret();
    if (!secret) throw new Error("Missing session protection");
    return createHash("sha256").update("ggsafe-preview-session-v1:").update(secret).digest();
  }
  function seal(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", privateKey(), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
  }
  function open(row) {
    const [version, iv, tag, data, extra] = row.private_json.split(".");
    if (version !== "v1" || extra !== undefined) throw new Error("Invalid session protection");
    const decipher = createDecipheriv("aes-256-gcm", privateKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8"));
    if (!value || typeof value.email !== "string" || !equal(hash(value.email.trim().toLowerCase()), row.email_hash) ||
        !isRandom(value.csrf) || !equal(hash(value.csrf), row.csrf_hash) || !isRandom(value.connectionId) ||
        !/^google:v1:[a-f0-9]{64}$/.test(row.owner_key) || !Number.isSafeInteger(row.expires_at)) throw new Error("Invalid session");
    return { origin: previewOrigin(value.origin), user: { email: value.email }, csrf: value.csrf, connectionId: value.connectionId, expires: row.expires_at };
  }

  function deleteFlow(id) {
    const flow = flows.get(id);
    if (!flow) return;
    clearTimeout(flow.expiryTimer);
    states.delete(flow.state);
    flows.delete(id);
  }
  async function deleteSession(id, expires) {
    const previous = sessionTimers.get(id);
    if (expires === undefined || previous?.expires === expires) {
      clearTimeout(previous?.timer);
      sessionTimers.delete(id);
    }
    await store.remove(id, expires);
  }
  function scheduleSession(id, expires) {
    if (sessionTimers.get(id)?.expires === expires) return;
    clearTimeout(sessionTimers.get(id)?.timer);
    const timer = expireAfter(Math.max(0, expires - now()), () => {
      void deleteSession(id, expires).catch(() => console.warn(JSON.stringify({ event: "google_preview_expiry_cleanup_failed" })));
    });
    sessionTimers.set(id, { timer, expires });
  }
  function expireAfter(milliseconds, remove) {
    const timer = setTimeout(remove, milliseconds);
    timer.unref?.();
    return timer;
  }
  async function cleanup() {
    for (const [id, flow] of flows) if (flow.expires <= now()) deleteFlow(id);
    for (const [id, entry] of sessionTimers) if (entry.expires <= now()) {
      clearTimeout(entry.timer); sessionTimers.delete(id);
    }
    await store.purge(now());
  }
  const sessionToken = req => req.headers["x-ggsafe-session"] !== undefined ? req.headers["x-ggsafe-session"] : cookies(req).get(SESSION_COOKIE);
  const sessionFor = async req => {
    const token = sessionToken(req);
    if (!isRandom(token)) return undefined;
    const row = await store.get(hash(token), now());
    if (!row) return undefined;
    try {
      const session = open(row);
      scheduleSession(hash(token), session.expires);
      return session;
    } catch { return undefined; }
  };
  const sessionData = session => ({ available: !!getSecret(), preview_only: true, user: session?.user ?? null, csrf: session?.csrf ?? null, connection_id: session?.connectionId ?? null, expires_at: session ? new Date(session.expires).toISOString() : null });

  return async function googlePreview(req, res, next) {
    const url = new URL(req.url ?? "/", "http://preview.invalid");
    if (!url.pathname.startsWith(`${GOOGLE_PREVIEW_PATH}/`)) { next(); return; }
    res.setHeader("cache-control", "no-store, max-age=0");
    res.setHeader("pragma", "no-cache");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-robots-tag", "noindex, nofollow");
    const endpoint = url.pathname.slice(GOOGLE_PREVIEW_PATH.length);
    try {
      await cleanup();
      if (req.method === "GET" && endpoint === "/session") {
        // 자동 상태 조회는 마지막 이용 시각을 변경하지 않는다.
        sendJson(res, sessionData(await sessionFor(req))); return;
      }
      if (req.method === "POST" && endpoint === "/activity") {
        const body = await jsonBody(req, 512);
        const session = await sessionFor(req);
        if (!session) { sendJson(res, { error: "로그인 시간이 지났어요. Google로 다시 로그인해 주세요." }, 401); return; }
        if (!equal(req.headers["x-ggsafe-csrf"], session.csrf)) { sendJson(res, { error: "로그인 확인값이 맞지 않아요. 다시 로그인해 주세요." }, 403); return; }
        const at = body.at ?? now();
        if (!Number.isSafeInteger(at) || at > now() + 5000 || at < now() - 60_000) throw new Error("Invalid activity");
        // 지연된 이용 알림은 실제 조작 시각을 기준으로 하고 만료된 연결은 되살리지 않는다.
        const row = await store.touch(hash(sessionToken(req)), now(), Math.min(at, now()) + SESSION_TTL);
        if (!row) { sendJson(res, { error: "로그인 시간이 지났어요. Google로 다시 로그인해 주세요." }, 401); return; }
        const nextSession = open(row);
        scheduleSession(hash(sessionToken(req)), nextSession.expires);
        setCookie(res, SESSION_COOKIE, sessionToken(req), nextSession.origin, Math.max(0, Math.floor((nextSession.expires - now()) / 1000)), true);
        sendJson(res, sessionData(nextSession)); return;
      }
      if (req.method === "POST" && endpoint === "/prepare") {
        if (!getSecret()) { sendJson(res, { error: "Google 연결 설정을 불러오지 못했어요. 설정한 비밀키를 확인해 주세요." }, 400); return; }
        const body = await jsonBody(req);
        const origin = previewOrigin(body.origin);
        if (body.mode !== undefined && body.mode !== "identity") throw new Error("Invalid login mode");
        if (typeof body.challenge !== "string" || !/^[a-f0-9]{64}$/.test(body.challenge)) throw new Error("Invalid challenge");
        if (flows.size >= 100 || await store.count(now()) >= 200) { sendJson(res, { error: "연결 요청이 많아요. 잠시 후 다시 시도해 주세요." }, 429); return; }
        const id = random(), state = random();
        const flow = { origin, mode: body.mode ?? "redirect", challenge: body.challenge, state, nonce: random(), verifier: random(), binder: random(), status: "prepared", expires: now() + FLOW_TTL, expiryTimer: expireAfter(FLOW_TTL, () => deleteFlow(id)) };
        flows.set(id, flow);
        states.set(state, id);
        if (flow.mode === "identity") {
          sendJson(res, { flow_id: id, client_id: GOOGLE_CLIENT_ID, nonce: flow.nonce, state: flow.state }); return;
        }
        sendJson(res, { flow_id: id, start_url: `${origin}${GOOGLE_PREVIEW_PATH}/start?flow=${id}` }); return;
      }
      if (req.method === "POST" && endpoint === "/identity") {
        const body = await jsonBody(req, 20 * 1024);
        const flow = flows.get(body.flow_id);
        if (!flow || flow.mode !== "identity" || flow.status !== "prepared" || !isBrowserProof(body.verifier) ||
            !equal(hash(body.verifier), flow.challenge) || !equal(body.state, flow.state) ||
            typeof body.credential !== "string" || !body.credential || body.credential.length > 16384) {
          sendJson(res, { error: "Google 로그인 요청을 확인하지 못했어요. 로그인 버튼을 다시 준비해 주세요." }, 400); return;
        }
        flow.status = "exchanging";
        try {
          const user = await verifyGoogleIdentity(body.credential, flow.nonce, keys);
          if (flows.get(body.flow_id) !== flow || flow.expires <= now()) throw new Error("Cancelled login");
          flow.user = user;
          flow.status = "complete";
          sendJson(res, { ok: true });
        } catch {
          flow.status = "error";
          flow.message = "Google의 계정 확인에 실패했어요. 로그인 버튼을 다시 준비해 주세요.";
          sendJson(res, { error: "Google의 계정 확인에 실패했어요. 로그인 버튼을 다시 준비해 주세요." }, 401);
        }
        return;
      }
      if (req.method === "GET" && endpoint === "/start") {
        const id = url.searchParams.get("flow");
        const flow = flows.get(id);
        if (!flow || flow.mode !== "redirect" || flow.status !== "prepared") { resultPage(res, "error", 400); return; }
        flow.status = "started";
        setCookie(res, `ggsafe_oauth_${id.slice(0, 12)}`, flow.binder, flow.origin, 600);
        const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authorization.search = new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID, response_type: "code", scope: "openid email", prompt: "select_account",
          redirect_uri: `${flow.origin}${GOOGLE_PREVIEW_PATH}/callback`, state: flow.state, nonce: flow.nonce,
          code_challenge: createHash("sha256").update(flow.verifier).digest("base64url"), code_challenge_method: "S256"
        }).toString();
        redirect(res, authorization.toString()); return;
      }
      if (req.method === "GET" && endpoint === "/callback") {
        const state = url.searchParams.get("state");
        const id = states.get(state);
        const flow = flows.get(id);
        const cookieName = id ? `ggsafe_oauth_${id.slice(0, 12)}` : "";
        if (!flow || flow.status !== "started" || !equal(cookies(req).get(cookieName), flow.binder)) { resultPage(res, "error", 400); return; }
        states.delete(state);
        flow.status = "exchanging";
        setCookie(res, cookieName, "", flow.origin, 0);
        const issuer = url.searchParams.get("iss");
        if (url.searchParams.has("error")) {
          flow.status = "error";
          flow.message = "Google 로그인을 취소했어요. 원할 때 다시 연결해 주세요.";
        } else if (issuer && issuer !== "https://accounts.google.com") {
          flow.status = "error"; flow.message = "Google의 응답을 확인하지 못했어요. 다시 로그인해 주세요.";
        } else {
          try {
            const code = url.searchParams.get("code");
            if (!code || code.length > 4096) throw new Error("Invalid authorization code");
            const tokenResponse = await fetchImpl("https://oauth2.googleapis.com/token", {
              method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: getSecret(), code, code_verifier: flow.verifier, redirect_uri: `${flow.origin}${GOOGLE_PREVIEW_PATH}/callback`, grant_type: "authorization_code" }),
              signal: AbortSignal.timeout(12000), redirect: "error"
            });
            const data = await smallJson(tokenResponse);
            if (!tokenResponse.ok || typeof data?.id_token !== "string" || data.id_token.length > 16384) throw new Error("Token exchange rejected");
            flow.user = await verifyGoogleIdentity(data.id_token, flow.nonce, keys);
            flow.status = "complete";
          } catch {
            // 원본 오류·응답에는 이메일·토큰이 있을 수 있어 로그에 남기지 않습니다.
            console.warn(JSON.stringify({ event: "google_preview_connection_failed" }));
            flow.status = "error";
            flow.message = "Google 연결을 확인하지 못해 로그인하지 않았어요. 등록한 돌아올 주소와 연결 설정을 확인한 뒤 다시 시도해 주세요.";
          }
        }
        // 일회용 코드를 주소창·참조 주소에 남기지 않도록 깨끗한 결과 화면으로 이동합니다.
        redirect(res, `${GOOGLE_PREVIEW_PATH}/result`); return;
      }
      if (req.method === "GET" && endpoint === "/result") { resultPage(res); return; }
      if (req.method === "POST" && ["/finish", "/cancel"].includes(endpoint)) {
        const body = await jsonBody(req);
        const flow = flows.get(body.flow_id);
        if (!flow || !isBrowserProof(body.verifier) || !equal(hash(body.verifier), flow.challenge)) {
          sendJson(res, { error: "로그인 요청이 만료됐거나 확인되지 않았어요. 다시 시도해 주세요." }, 400); return;
        }
        if (endpoint === "/cancel") {
          deleteFlow(body.flow_id);
          sendJson(res, { ok: true }); return;
        }
        if (["prepared", "started", "exchanging"].includes(flow.status)) { sendJson(res, { state: "pending" }); return; }
        if (body.session_key !== undefined && (!isRandom(body.session_key) || await store.get(hash(body.session_key), now()))) {
          sendJson(res, { error: "연결 유지 요청을 확인하지 못했어요. Google 로그인을 다시 시도해 주세요." }, 400); return;
        }
        deleteFlow(body.flow_id);
        if (flow.status === "error") { sendJson(res, { state: "error", message: flow.message }); return; }
        // 쿠키를 전달하지 않는 미리보기에서도, 검증을 마친 화면이 만든 별도 키로 연결한다.
        // 이 키는 응답 본문·주소·로그에 넣지 않으며 서버에는 해시만 남긴다.
        const token = body.session_key ?? random();
        const session = { origin: flow.origin, user: { email: flow.user.email }, csrf: random(), connectionId: random(), expires: now() + SESSION_TTL };
        const sessionId = hash(token);
        await store.insert(sessionId, {
          owner_key: `google:v1:${hash(`https://accounts.google.com:${flow.user.subject}`)}`,
          email_hash: hash(flow.user.email.trim().toLowerCase()), csrf_hash: hash(session.csrf),
          private_json: seal({ email: session.user.email, origin: session.origin, csrf: session.csrf, connectionId: session.connectionId }),
          expires_at: session.expires,
        });
        for (const previous of [sessionToken(req), cookies(req).get(SESSION_COOKIE)]) {
          if (isRandom(previous)) await deleteSession(hash(previous));
        }
        scheduleSession(sessionId, session.expires);
        // 원래 미리보기에서 발급해 삽입된 화면에서도 분리된 쿠키를 사용할 수 있어요.
        setCookie(res, SESSION_COOKIE, token, flow.origin, SESSION_TTL / 1000, true);
        sendJson(res, { state: "complete", session: sessionData(session) }); return;
      }
      if (req.method === "POST" && endpoint === "/logout") {
        await jsonBody(req);
        const session = await sessionFor(req);
        if (session && !equal(req.headers["x-ggsafe-csrf"], session.csrf)) { sendJson(res, { error: "연결 해제 요청을 확인하지 못했어요. 새로고침 후 다시 시도해 주세요." }, 403); return; }
        const token = sessionToken(req);
        if (isRandom(token)) await deleteSession(hash(token));
        setCookie(res, SESSION_COOKIE, "", session?.origin ?? "https://preview.baze.cloud", 0, true);
        sendJson(res, sessionData(undefined)); return;
      }
      sendJson(res, { error: "지원하지 않는 연결 요청이에요." }, 404);
    } catch {
      // 경로·코드·비밀키·원본 응답을 오류 메시지나 로그에 포함하지 않습니다.
      sendJson(res, { error: "Google 연결 요청을 확인하지 못했어요. GGSAFE에서 다시 시작해 주세요." }, 400);
    }
  };
}

export function googlePreviewPlugin() {
  return {
    name: "ggsafe-google-preview", apply: "serve",
    async configureServer(server) {
      // 로컬 전용 바인딩이다. 공개되는 주소나 임의 헤더로 연결을 발급하는 통로는 없다.
      const { getPlatformProxy } = await import("wrangler");
      const platform = await getPlatformProxy({ configPath: "wrangler.jsonc", remoteBindings: false });
      server.middlewares.use(createGooglePreview({ store: databaseGoogleSessions(platform.env.DB) }));
      server.httpServer?.once("close", () => { void platform.dispose().catch(() => {}); });
    }
  };
}
