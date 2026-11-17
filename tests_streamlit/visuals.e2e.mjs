// 시각화만 점검한다. 합성 계정·로컬 보관과 가로챈 외부 응답만 사용한다.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
const require = createRequire(import.meta.url), { chromium } = require("/usr/local/lib/node_modules/playwright");
const base = "http://localhost:5173", project = createHash("sha256").update(resolve(".")).digest("hex").slice(0, 16);
const python = join(homedir(), ".cache/ggsafe-streamlit", project, "venv/bin/python");
const subjects = [], errors = [], report = [];
function support(subject, action, extra = {}) {
  const output = spawnSync(python, ["-m", "tests_streamlit.browser_support"], { input: JSON.stringify({ subject, action, ...extra }), encoding: "utf8" });
  if (output.status) throw new Error("합성 검사 준비에 실패했어요.");
  return JSON.parse(output.stdout);
}
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  for (const width of [320, 390, 1440]) {
    const subject = `synthetic-streamlit-${randomUUID()}`; subjects.push(subject);
    const identity = support(subject, "identity");
    const context = await browser.newContext({ viewport: { width, height: 850 }, reducedMotion: width === 320 ? "reduce" : "no-preference" });
    await context.addCookies([{ name: "_streamlit_user", value: identity.cookie, url: base, httpOnly: true, sameSite: "Lax" }]);
    await context.addInitScript(() => {
      if (window === window.top) return;
      window.addEventListener("message", event => {
        if (event.source !== window.parent || event.data?.type !== "streamlit:render") return;
        const value = event.data.args?.reply?.value;
        // 실제 응답을 잠시 잡아 진행 상태가 응답 없이 완료되지 않는지 확인한다.
        if (window.__holdEmail && Array.isArray(value?.breaches)) {
          window.__heldEmail = event.data; event.stopImmediatePropagation();
        }
        // 오류 화면은 합성 응답으로만 확인한다. 공개 앱이나 보관 결과를 바꾸지 않는다.
        if (window.__emailError && Array.isArray(value?.breaches)) {
          Object.assign(value, { status: "timeout", message: "합성 테스트: 조회 응답을 받지 못했어요.", breach_count: 0, breaches: [] });
          window.__emailError = false;
        }
      });
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror", error => errors.push(error.message));
    let frame, component;
    async function open() {
      await page.goto(base, { waitUntil: "domcontentloaded" });
      frame = page.frameLocator('iframe[title$=".ui"]');
      await frame.locator(".gg-app").waitFor();
      component = page.frames().find(item => item.url().includes("/component/"));
      await frame.locator(".gg-mobile-nav").getByRole("link", { name: "보안 검사", exact: true }).click();
    }
    async function fitted() {
      await component.waitForFunction(() => Math.abs(innerHeight - document.getElementById("root").getBoundingClientRect().height) < 3);
      assert.equal(await component.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    const journey = () => frame.getByRole("region", { name: "검사 진행 상황", exact: true });
    const visual = () => frame.locator(".gg-scan-result-visual");
    async function emailStart() {
      await frame.getByRole("checkbox", { name: /이메일 주소의 외부 전송에 동의해요/ }).check();
      await frame.getByRole("button", { name: "내 이메일 검사하기", exact: true }).click();
    }
    await open(); await fitted();
    assert.equal(await journey().getAttribute("data-state"), "ready");
    assert.equal(await journey().locator('[data-step-state="waiting"]').count(), 3);
    assert.equal(await frame.getByRole("checkbox", { name: /이메일 원문 없이 검사 이력을 저장해요/ }).isChecked(), false);
    support(subject, "seed", { count: 12 });
    await component.evaluate(() => { window.__holdEmail = true; });
    await frame.getByRole("checkbox", { name: /이메일 원문 없이 검사 이력을 저장해요/ }).check();
    await emailStart();
    await component.waitForFunction(() => !!window.__heldEmail);
    assert.equal(await journey().getAttribute("data-state"), "running");
    assert.ok((await journey().locator('[aria-current="step"]').innerText()).includes("유출 기록 조회"));
    assert.equal(await visual().count(), 0);
    if (width === 320) assert.equal(await journey().locator(".gg-spinning").evaluate(el => getComputedStyle(el).animationName), "none");
    await fitted();
    await journey().screenshot({ path: `/tmp/opencode/ggsafe-visuals-email-running-${width}.png` });
    await component.evaluate(() => {
      window.__holdEmail = false;
      const data = window.__heldEmail; window.__heldEmail = null;
      window.dispatchEvent(new MessageEvent("message", { source: window.parent, data }));
    });
    await frame.locator('.gg-scan-journey[data-state="complete"]').waitFor();
    assert.equal(await journey().locator('[data-step-state="done"]').count(), 3);
    assert.equal(await visual().getAttribute("data-outcome"), "found");
    assert.equal(await visual().locator(".gg-visual-count strong").innerText(), "12");
    assert.equal(await frame.locator(".gg-breach-list li").count(), 10);
    assert.equal(support(subject, "rows").length, 1);
    await fitted();
    await visual().screenshot({ path: `/tmp/opencode/ggsafe-visuals-email-result-${width}.png` });
    await frame.getByRole("button", { name: "다음 서비스 목록", exact: true }).click();
    assert.equal(await frame.locator(".gg-breach-list li").count(), 2);
    // 새 화면의 첫 검사는 캐시만 사용한다. 실제 이메일 외부 조회를 하지 않는다.
    await open(); support(subject, "seed", { count: 0 });
    await emailStart(); await frame.locator('.gg-scan-result-visual[data-outcome="not_found"]').waitFor();
    assert.equal(await visual().locator(".gg-visual-count strong").innerText(), "0");
    assert.ok((await visual().innerText()).includes("안전을 보장하지 않아요"));
    assert.equal(support(subject, "rows").length, 1);
    await fitted();
    await visual().screenshot({ path: `/tmp/opencode/ggsafe-visuals-not-found-${width}.png` });
    await open(); support(subject, "seed", { count: 0 });
    await component.evaluate(() => { window.__emailError = true; });
    await emailStart(); await frame.locator('.gg-scan-result-visual[data-outcome="incomplete"]').waitFor();
    assert.equal(await journey().getAttribute("data-state"), "incomplete");
    assert.equal(await visual().locator(".gg-visual-count").count(), 0);
    assert.equal(await journey().locator('[data-step-state="stopped"]').count(), 1);
    await fitted();
    await visual().screenshot({ path: `/tmp/opencode/ggsafe-visuals-email-error-${width}.png` });

    await frame.getByRole("tab", { name: /비밀번호/ }).click();
    let mode = "hold", suffix, release, requests = 0;
    await context.route("https://api.pwnedpasswords.com/range/*", async route => {
      requests++;
      if (mode === "hold") await new Promise(resolve => { release = resolve; });
      try {
        if (mode === "error") await route.fulfill({ status: 503, body: "synthetic failure" });
        else await route.fulfill({ status: 200, contentType: "text/plain", body: `${suffix}:${mode === "not_found" ? 0 : 12345}\r\n${"F".repeat(35)}:2` });
      } catch { /* 취소한 조회의 늦은 응답은 사용하지 않는다. */ }
    });
    async function passwordStart() {
      const password = `GGSAFE synthetic ${randomUUID()}`;
      suffix = createHash("sha1").update(password).digest("hex").toUpperCase().slice(5);
      await frame.getByLabel("검사할 비밀번호", { exact: false }).fill(password);
      await frame.getByRole("checkbox", { name: /변환값 앞 5글자의 외부 전송에 동의해요/ }).check();
      await frame.getByRole("button", { name: "비밀번호 검사하기", exact: true }).click();
    }
    const holding = page.waitForRequest("https://api.pwnedpasswords.com/range/*");
    await passwordStart(); await holding;
    assert.equal(await journey().getAttribute("data-state"), "running");
    assert.ok((await journey().locator('[aria-current="step"]').innerText()).includes("유출 자료 조회"));
    await fitted();
    await journey().screenshot({ path: `/tmp/opencode/ggsafe-visuals-password-running-${width}.png` });
    await frame.getByRole("button", { name: "검사 중단", exact: true }).click();
    await frame.locator('.gg-scan-journey[data-state="incomplete"]').waitFor(); release?.();
    assert.equal(await visual().getAttribute("data-outcome"), "incomplete");
    assert.equal(await visual().locator(".gg-visual-count").count(), 0);
    assert.equal(support(subject, "rows").length, 1);
    await frame.getByRole("button", { name: "입력 지우기", exact: true }).click();
    assert.equal(await journey().getAttribute("data-state"), "ready");
    assert.equal(await visual().count(), 0); assert.equal(requests, 1);
    mode = "not_found"; await passwordStart();
    await frame.getByText("검사 이력 저장됨", { exact: true }).waitFor();
    assert.equal(await visual().getAttribute("data-outcome"), "not_found");
    assert.equal(await visual().locator(".gg-visual-count strong").innerText(), "0");
    mode = "found"; await passwordStart();
    await frame.getByText("검사 이력 저장됨", { exact: true }).waitFor();
    assert.equal(await visual().getAttribute("data-outcome"), "found");
    assert.equal(await visual().locator(".gg-visual-count strong").innerText(), "12,345");
    assert.ok((await visual().innerText()).includes("계정이나 서비스 개수가 아니며"));
    assert.equal(support(subject, "rows").length, 3);
    await fitted();
    await visual().screenshot({ path: `/tmp/opencode/ggsafe-visuals-password-result-${width}.png` });
    await page.screenshot({ path: `/tmp/opencode/ggsafe-visuals-screen-${width}.png` });
    mode = "error"; await passwordStart();
    await frame.locator('.gg-scan-journey[data-state="incomplete"]').waitFor();
    assert.equal(await visual().getAttribute("data-outcome"), "incomplete");
    assert.equal(await visual().locator(".gg-visual-count").count(), 0);
    assert.equal(support(subject, "rows").length, 3);
    await fitted();
    report.push({ width, real_stages: true, no_fake_completion: true, found_and_not_found: true, errors_not_zero: true, cancel_and_reset: true, storage_preserved: true, no_overflow: true, reduced_motion: width === 320 });
    await context.close();
  }
  assert.deepEqual(errors, []); console.log(JSON.stringify(report));
} finally {
  await browser.close();
  for (const subject of subjects) support(subject, "cleanup");
}
