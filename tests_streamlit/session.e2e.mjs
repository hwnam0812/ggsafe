// 합성 Streamlit 쿠키로 만료·위조·다른 탭 로그아웃을 실제 실행 중인 앱에서 확인한다.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
const require = createRequire(import.meta.url), { chromium } = require("/usr/local/lib/node_modules/playwright");
const base = "http://localhost:5173", hash = createHash("sha256").update(resolve(".")).digest("hex").slice(0, 16);
const python = ["/tmp/opencode/ggsafe-streamlit-venv/bin/python", join(homedir(), ".cache/ggsafe-streamlit", hash, "venv/bin/python")].find(existsSync);
const subjects = [], errors = [];
function support(subject, action, extra = {}) {
  const output = spawnSync(python, ["-m", "tests_streamlit.browser_support"], { input: JSON.stringify({ subject, action, ...extra }), encoding: "utf8" });
  if (output.status) throw new Error("합성 검사 준비에 실패했어요.");
  return JSON.parse(output.stdout);
}
function account(extra = {}) {
  const subject = `synthetic-streamlit-${randomUUID()}`; subjects.push(subject);
  return { subject, ...support(subject, "identity", extra) };
}
const browser = await chromium.launch({ args: ["--no-sandbox"] });
async function context(who, cookie = who.cookie) {
  const ctx = await browser.newContext({ viewport: { width: 558, height: 760 } });
  await ctx.addInitScript(() => window.addEventListener("message", event => {
    if (event.source === window.parent && event.data?.type === "streamlit:render" && event.data.args?.session) window.__testNativeSession = event.data.args.session;
  }));
  await ctx.addCookies([{ name: "_streamlit_user", value: cookie, url: base, httpOnly: true, sameSite: "Lax" }]);
  ctx.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  return ctx;
}
async function open(ctx) {
  const page = await ctx.newPage(); page.setDefaultTimeout(12000);
  await page.goto(base, { waitUntil: "domcontentloaded" });
  const frame = page.frameLocator('iframe[title$=".ui"]');
  await frame.locator(".gg-login-card,.gg-app").waitFor();
  return { page, frame };
}
try {
  const expired = account({ issued: Date.now() / 1000 - 30 * 86400 - 1 });
  const old = await context(expired), oldView = await open(old);
  await oldView.frame.getByRole("alert").waitFor();
  assert.ok((await oldView.frame.getByRole("alert").innerText()).includes("로그인 시간이 지났어요"));
  assert.equal(await oldView.frame.locator(".gg-app,input[type=password]").count(), 0); await old.close();
  const forged = account(), invalid = await context(forged, forged.cookie + "tampered"), invalidView = await open(invalid);
  assert.equal(await invalidView.frame.locator(".gg-app").count(), 0); await invalid.close();
  const who = account(), ctx = await context(who), first = await open(ctx), second = await open(ctx);
  await first.frame.locator(".gg-app").waitFor(); await second.frame.locator(".gg-app").waitFor();
  const component = first.page.frames().find(frame => frame.url().includes("/component/"));
  // 이미 끝난 과거 응답으로 현재 계정을 끊지 않는다.
  await component.evaluate(() => window.dispatchEvent(new MessageEvent("message", { source: window.parent, data: { type: "streamlit:render", args: { session: window.__testNativeSession, reply: { id: "unknown", ok: false, status: 401 } } } })));
  assert.equal(await first.frame.locator(".gg-app").count(), 1);
  await second.frame.locator(".gg-navigation:visible,.gg-mobile-nav:visible").getByRole("link", { name: "보안 검사", exact: true }).click();
  await second.frame.getByRole("tab", { name: /비밀번호/ }).click();
  const input = second.frame.getByLabel("검사할 비밀번호", { exact: false });
  await input.fill(`GGSAFE synthetic ${randomUUID()}`);
  await second.frame.getByRole("checkbox", { name: /변환값 앞 5글자의 외부 전송에 동의해요/ }).check();
  let release;
  await ctx.route("https://api.pwnedpasswords.com/range/*", async route => {
    await new Promise(resolve => { release = resolve; });
    try { await route.fulfill({ status: 200, contentType: "text/plain", body: `${"A".repeat(35)}:0` }); } catch { /* 로그아웃이 조회를 중단한다. */ }
  });
  const holding = second.page.waitForRequest("https://api.pwnedpasswords.com/range/*");
  await second.frame.getByRole("button", { name: "비밀번호 검사하기", exact: true }).click(); await holding;
  await first.frame.getByRole("button", { name: "Google 계정 연결됨", exact: true }).click();
  await first.frame.getByRole("button", { name: "로그아웃", exact: true }).click();
  await second.frame.getByRole("button", { name: "Google로 로그인", exact: true }).waitFor(); release?.();
  await first.page.frameLocator('iframe[title$=".ui"]').getByRole("button", { name: "Google로 로그인", exact: true }).waitFor();
  assert.equal(await second.frame.locator(".gg-app,input[type=password],.gg-result").count(), 0);
  assert.equal(support(who.subject, "rows").length, 0);
  await ctx.close(); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ expired_blocked: true, forged_cookie_blocked: true, other_tab_logout_locked: true, pending_password_cancelled: true, late_response_not_saved: true, page_errors: 0 }));
} finally {
  await browser.close();
  for (const subject of subjects) support(subject, "cleanup");
}
