// 실제 미리보기 저장소·검사 처리기를 쓰되 Google 신원과 외부 서비스만 합성한다.
// 합성 Google 서명을 받는 처리기는 이 시험 프로세스에만 있으며 앱에는 시험용 진입점을 만들지 않는다.
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { getPlatformProxy } from "wrangler";
import { generateKeyPair, SignJWT } from "jose";
import { createGooglePreview, GOOGLE_CLIENT_ID } from "../scripts/google-preview.mjs";
import { databaseGoogleSessions } from "../scripts/google-session-store.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("/usr/local/lib/node_modules/playwright");
const sha256 = value => createHash("sha256").update(value).digest("hex");
export const previewBase = "http://localhost:5173";
export const sessionStorageName = "ggsafe.google.preview.session.v2";

export async function createAccountPreview() {
  const platform = await getPlatformProxy({ configPath: "wrangler.jsonc", remoteBindings: false });
  const db = platform.env.DB;
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const run = randomUUID(), identities = new Map();
  const auth = createGooglePreview({ getSecret: () => `synthetic-only-${run}`, keys: publicKey, store: databaseGoogleSessions(db) });
  function identity(name) {
    if (!identities.has(name)) identities.set(name, { subject: `ggsafe-test-${run}-${name}`, email: `ggsafe-test-${run}-${name}@example.com` });
    return identities.get(name);
  }
  function owner(who) { return `google:v1:${sha256(`https://accounts.google.com:${who.subject}`)}`; }
  async function seedEmail(who) {
    const value = { status: "not_found", message: "합성 검사 응답이에요.", breach_count: 0, breaches: [], source: "테스트 전용", checked_at: new Date().toISOString(), cached: false };
    await db.prepare("INSERT INTO security_cache (email_hash,result_json,expires_at) VALUES (?, ?, ?) ON CONFLICT(email_hash) DO UPDATE SET result_json = excluded.result_json, expires_at = excluded.expires_at")
      .bind(sha256(who.email.toLowerCase()), JSON.stringify(value), Math.floor(Date.now() / 1000) + 300).run();
  }
  async function newContext({ who = identity("a"), width = 1440, storageState } = {}) {
    let selected = who;
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "ko-KR", isMobile: width < 600, hasTouch: width < 600, storageState });
    await context.exposeBinding("__ggsafeSyntheticIdentity", async (_source, nonce) => {
      const at = Math.floor(Date.now() / 1000);
      return new SignJWT({ iss: "https://accounts.google.com", aud: GOOGLE_CLIENT_ID, sub: selected.subject, email: selected.email, email_verified: true, nonce, iat: at, exp: at + 3600 }).setProtectedHeader({ alg: "RS256" }).sign(privateKey);
    });
    await context.route("https://accounts.google.com/gsi/client**", route => route.fulfill({ contentType: "text/javascript", body: `(() => {
      let options;
      window.google = { accounts: { id: {
        initialize(value) { options = value; },
        renderButton(element, config) {
          const button = document.createElement('button');
          button.textContent = '시험용 Google 계정으로 계속'; button.type = 'button';
          button.style.cssText = 'border:1px solid #c5d2e3;border-radius:5px;padding:12px 16px;background:#fff;color:#24324b;min-height:44px;width:100%';
          button.onclick = async () => { config.click_listener?.(); const credential = await window.__ggsafeSyntheticIdentity(options.nonce); options.callback({ credential, state: config.state }); };
          element.replaceChildren(button);
        }, disableAutoSelect() {}
      } } };
    })();` }));
    await context.route("**/api/preview-google/**", async route => {
      const request = route.request(), headers = await request.allHeaders(); delete headers.cookie;
      const req = Readable.from(request.postData() ? [Buffer.from(request.postData())] : []);
      const url = new URL(request.url());
      Object.assign(req, { url: `${url.pathname}${url.search}`, method: request.method(), headers });
      const outgoing = new Map(); let status = 200, body = "";
      const response = { statusCode: 200, getHeader: key => outgoing.get(key), setHeader: (key, value) => outgoing.set(key, value), end(text = "") { status = this.statusCode; body = text; } };
      await auth(req, response, () => { throw new Error("Unexpected auth route"); });
      outgoing.delete("set-cookie");
      await route.fulfill({ status, headers: Object.fromEntries(outgoing), body });
    });
    return { context, select: value => { selected = value; } };
  }
  async function login(page) {
    await page.getByRole("button", { name: "Google로 로그인", exact: true }).click();
    await page.getByRole("button", { name: "시험용 Google 계정으로 계속", exact: true }).click();
    await page.locator(".gg-workspace").waitFor();
  }
  async function close() {
    await browser.close();
    // 이 실행에서 만든 합성 계정의 행만 정리한다. 기존 사용자 기록은 읽거나 바꾸지 않는다.
    for (const who of identities.values()) {
      await db.batch([
        db.prepare("DELETE FROM security_history WHERE owner_key = ?").bind(owner(who)),
        db.prepare("DELETE FROM security_password_history WHERE owner_key = ?").bind(owner(who)),
        db.prepare("DELETE FROM security_account_sessions WHERE owner_key = ?").bind(owner(who)),
        db.prepare("DELETE FROM security_cache WHERE email_hash = ?").bind(sha256(who.email.toLowerCase())),
      ]);
    }
    await platform.dispose();
  }
  return { browser, db, identity, owner, newContext, login, seedEmail, close,
    query: async command => (await db.prepare(command).bind().all()).results,
  };
}
