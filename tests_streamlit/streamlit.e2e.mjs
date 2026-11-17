// 실행 중인 로컬 Streamlit 전용. 실제 Google 계정·이메일·비밀번호를 조회하지 않는다.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("/usr/local/lib/node_modules/playwright");
const base = "http://localhost:5173";
const project = createHash("sha256").update(resolve(".")).digest("hex").slice(0, 16);
const python = ["/tmp/opencode/ggsafe-streamlit-venv/bin/python", join(homedir(), ".cache/ggsafe-streamlit", project, "venv/bin/python")].find(existsSync);
if (!python) throw new Error("Streamlit 미리보기를 먼저 시작해 주세요.");
function support(subject, action, extra = {}) {
  const result = spawnSync(python, ["-m", "tests_streamlit.browser_support"], { input: JSON.stringify({ subject, action, ...extra }), encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  if (result.status !== 0) throw new Error("합성 테스트 준비를 완료하지 못했어요.");
  return JSON.parse(result.stdout);
}
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const accounts = [];
const errors = [];
const report = [];
async function contextFor(subject, width, extra = {}) {
  const identity = support(subject, "identity", extra);
  const context = await browser.newContext({ viewport: { width, height: 960 } });
  await context.addInitScript(() => {
    if (window !== window.top) {
      let passwordRequest;
      window.parent.addEventListener("message", event => {
        if (event.source === window && event.data?.type === "streamlit:setComponentValue" && event.data.value?.action === "password") passwordRequest = event.data.value.id;
      });
      // 화면 코드보다 먼저 등록해 실제 완료 응답 하나만 유실된 상황으로 바꾼다.
      window.addEventListener("message", event => {
        const reply = event.data?.args?.reply;
        if (window.__ggsafeFailSaveReply && passwordRequest && reply?.id === passwordRequest && reply.value?.history_saved === true) {
          reply.value.history_saved = false;
          window.__ggsafeFailSaveReply = false;
        }
      });
      return;
    }
    window.__ggsafeRequests = [];
    window.addEventListener("message", event => {
      if (event.data?.type === "streamlit:setComponentValue") window.__ggsafeRequests.push(event.data.value);
    });
  });
  await context.addCookies([{ name: "_streamlit_user", value: identity.cookie, url: base, httpOnly: true, sameSite: "Lax", expires: Date.now() / 1000 + 86400 }]);
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  return { identity, context };
}
async function open(context) {
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  await page.goto(base, { waitUntil: "domcontentloaded" });
  const frame = page.frameLocator('iframe[title$=".ui"]');
  await frame.locator(".gg-login-card,.gg-app").waitFor();
  return { page, frame };
}
async function nav(frame, title) { await frame.locator(".gg-navigation:visible,.gg-mobile-nav:visible").getByRole("link", { name: title, exact: true }).click(); }

try {
  const anonymous = await browser.newContext();
  const anonymousView = await open(anonymous);
  await anonymousView.frame.getByRole("button", { name: "Google로 로그인", exact: true }).waitFor();
  assert.equal(await anonymousView.frame.locator(".gg-app,.gg-history-table,input[type=password]").count(), 0);
  await anonymous.close();
  for (const width of [1440, 558, 383]) {
    const subject = `synthetic-streamlit-${randomUUID()}`; accounts.push(subject);
    const { context, identity } = await contextFor(subject, width);
    let { page, frame } = await open(context);
    await frame.locator(".gg-app").waitFor();
    let ranges = 0, mode = "found", suffix = "", release;
    const sensitive = [];
    await context.route("https://api.pwnedpasswords.com/range/*", async route => {
      ranges++;
      assert.equal(route.request().headers()["add-padding"], "true");
      assert.equal(route.request().headers().cookie, undefined);
      assert.equal(route.request().headers().referer, undefined);
      if (mode === "hold") await new Promise(resolve => { release = resolve; });
      try {
        if (mode === "error") await route.fulfill({ status: 503, body: "synthetic failure" });
        else await route.fulfill({ status: 200, contentType: "text/plain", body: `${mode === "found" ? suffix : "A".repeat(35)}:12345\r\n${"B".repeat(35)}:0` });
      } catch { /* 사용자가 중단한 조회는 버린다. */ }
    });
    async function prepare() {
      const password = `GGSAFE synthetic ${randomUUID()}`;
      const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
      sensitive.push(password, hash); suffix = hash.slice(5);
      await frame.getByLabel("검사할 비밀번호", { exact: false }).fill(password);
    }
    async function runPassword() {
      await prepare();
      await frame.getByRole("checkbox", { name: /변환값 앞 5글자의 외부 전송에 동의해요/ }).check();
      await frame.getByRole("button", { name: "비밀번호 검사하기", exact: true }).click();
    }
    await nav(frame, "보안 검사");
    await frame.getByRole("tab", { name: /비밀번호/ }).click();
    await prepare();
    await frame.getByRole("button", { name: "비밀번호 검사하기", exact: true }).click();
    await frame.getByRole("alert").waitFor(); assert.equal(ranges, 0);
    await frame.getByRole("checkbox", { name: /변환값 앞 5글자의 외부 전송에 동의해요/ }).check();
    await frame.getByRole("button", { name: "비밀번호 검사하기", exact: true }).click();
    await frame.getByText("검사 이력 저장됨", { exact: true }).waitFor();
    assert.equal(support(subject, "rows").length, 1);
    await page.screenshot({ path: `/tmp/opencode/ggsafe-streamlit-password-${width}.png`, fullPage: true });
    await frame.getByRole("link", { name: "검사 이력 보기", exact: true }).click();
    await frame.locator(".gg-history-table tbody tr").waitFor();
    assert.ok((await frame.locator(".gg-history-table").innerText()).includes("12,345회"));
    const initialRequests = await page.evaluate(() => window.__ggsafeRequests ?? []);
    await page.reload({ waitUntil: "domcontentloaded" });
    frame = page.frameLocator('iframe[title$=".ui"]');
    await frame.locator(".gg-app").waitFor(); await nav(frame, "검사 이력");
    await frame.locator(".gg-history-table tbody tr").waitFor();
    assert.equal(await frame.locator(".gg-history-table tbody tr").count(), 1);
    // 완료 응답만 잃어버린 상황을 합성한다. 실제 저장 후 동일 구분값의 저장만 재시도한다.
    await nav(frame, "보안 검사"); await frame.getByRole("tab", { name: /비밀번호/ }).click();
    const iframe = page.frames().find(item => item.url().includes("/component/"));
    await iframe.evaluate(() => { window.__ggsafeFailSaveReply = true; });
    await runPassword(); await frame.getByRole("button", { name: "이력 저장 다시 시도", exact: true }).waitFor();
    const beforeRetry = ranges;
    await frame.getByRole("button", { name: "이력 저장 다시 시도", exact: true }).click();
    await frame.getByText("검사 이력 저장됨", { exact: true }).waitFor();
    assert.equal(ranges, beforeRetry); assert.equal(support(subject, "rows").length, 2);
    mode = "error";
    await runPassword(); await frame.getByRole("heading", { name: "검사를 완료하지 못했어요", exact: true }).waitFor();
    assert.equal(support(subject, "rows").length, 2);
    mode = "hold";
    const holding = page.waitForRequest("https://api.pwnedpasswords.com/range/*");
    await runPassword(); await holding;
    await frame.getByRole("button", { name: "검사 중단", exact: true }).click(); release?.();
    assert.equal(support(subject, "rows").length, 2);
    await nav(frame, "보안 검사"); await frame.getByRole("tab", { name: /이메일/ }).click();
    assert.equal((await frame.locator(".gg-verified-email").innerText()).trim(), identity.email);
    assert.equal(await frame.locator('input[type="email"]').count(), 0);
    assert.equal(await frame.getByRole("checkbox", { name: /이메일 주소의 외부 전송에 동의해요/ }).isChecked(), false);
    assert.equal(await frame.getByRole("checkbox", { name: /이메일 원문 없이 검사 이력을 저장해요/ }).isChecked(), false);
    support(subject, "seed", { count: 12 });
    await frame.getByRole("checkbox", { name: /이메일 주소의 외부 전송에 동의해요/ }).check();
    await frame.getByRole("checkbox", { name: /이메일 원문 없이 검사 이력을 저장해요/ }).check();
    await frame.getByRole("button", { name: "내 이메일 검사하기", exact: true }).click();
    await frame.getByText("이메일 원문 없이 검사 이력을 저장했어요.", { exact: true }).waitFor();
    assert.equal(await frame.locator(".gg-breach-list li").count(), 10);
    await frame.getByRole("button", { name: "다음 서비스 목록", exact: true }).click();
    assert.equal(await frame.locator(".gg-breach-list li").count(), 2);
    await frame.getByRole("searchbox", { name: "유출 서비스 검색", exact: true }).fill("합성 예시 서비스 12");
    assert.equal(await frame.locator(".gg-breach-list li").count(), 1);
    await nav(frame, "해결 가이드");
    await frame.getByRole("heading", { name: "해결 가이드", exact: true }).waitFor();
    assert.equal(await frame.getByRole("link", { name: /Google에서 로그인 기기 보기/ }).getAttribute("href"), "https://www.google.com/devices");
    assert.equal(await frame.getByRole("link", { name: /Google 연결 앱 보기/ }).getAttribute("target"), "_blank");
    await nav(frame, "검사 이력");
    await frame.locator(".gg-history-table tbody tr").nth(2).waitFor();
    assert.equal(await frame.locator(".gg-history-table tbody tr").count(), 3);
    await frame.getByRole("button", { name: "검사 미완료", exact: true }).click();
    await frame.getByRole("heading", { name: "해당하는 검사 기록이 없어요", exact: true }).waitFor();
    await frame.getByRole("button", { name: "전체", exact: true }).click();
    assert.equal(await iframe.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `/tmp/opencode/ggsafe-streamlit-history-${width}.png`, fullPage: true });
    const requests = [...initialRequests, ...await page.evaluate(() => window.__ggsafeRequests ?? [])];
    const storage = await iframe.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    const rows = support(subject, "rows");
    for (const secret of sensitive) {
      assert.ok(!JSON.stringify(requests).includes(secret)); assert.ok(!JSON.stringify(rows).includes(secret)); assert.ok(!storage.includes(secret));
    }
    assert.ok(!JSON.stringify(rows).includes(identity.email)); assert.ok(!storage.includes(identity.email));
    const otherSubject = `synthetic-streamlit-${randomUUID()}`; accounts.push(otherSubject);
    const second = await contextFor(otherSubject, width); const otherView = await open(second.context);
    await nav(otherView.frame, "검사 이력");
    await otherView.frame.getByRole("heading", { name: "아직 저장한 검사 이력이 없어요", exact: true }).waitFor();
    await second.context.close();
    // 같은 계정의 다른 브라우저는 같은 기록을 보지만, 처음에는 별도 로그인이 필요하다.
    const same = await contextFor(subject, width); const sameView = await open(same.context);
    await nav(sameView.frame, "검사 이력"); await sameView.frame.locator(".gg-history-table tbody tr").first().waitFor();
    assert.equal(await sameView.frame.locator(".gg-history-table tbody tr").count(), 3); await same.context.close();
    await frame.getByRole("button", { name: "기록 삭제", exact: true }).click();
    await frame.getByRole("button", { name: "취소", exact: true }).click(); assert.equal(support(subject, "rows").length, 3);
    await frame.getByRole("button", { name: "기록 삭제", exact: true }).click();
    await frame.getByRole("button", { name: "검사 이력 삭제", exact: true }).click();
    await frame.getByRole("heading", { name: "아직 저장한 검사 이력이 없어요", exact: true }).waitFor();
    assert.equal(support(subject, "rows").length, 0);
    await frame.getByRole("button", { name: "Google 계정 연결됨", exact: true }).click();
    await frame.getByRole("button", { name: "로그아웃", exact: true }).click();
    await page.frameLocator('iframe[title$=".ui"]').getByRole("button", { name: "Google로 로그인", exact: true }).waitFor();
    assert.equal(await page.frameLocator('iframe[title$=".ui"]').locator(".gg-app").count(), 0);
    report.push({ width, anonymous_blocked: true, metadata_saved: true, reload_and_cross_browser: true, account_isolation: true, no_raw_password_or_hash: true, save_retry_without_duplicate_or_lookup: true, errors_not_saved: true, delete_confirmed: true, logout_blocked: true, horizontal_overflow: false });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  for (const subject of accounts) support(subject, "cleanup");
}
