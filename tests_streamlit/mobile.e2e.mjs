// 실제 Streamlit iframe의 scrolling=no 상태에서 휴대폰 제스처와 내용 높이 갱신을 검사한다.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
const require = createRequire(import.meta.url), { chromium } = require("/usr/local/lib/node_modules/playwright");
const base = "http://localhost:5173", hash = createHash("sha256").update(resolve(".")).digest("hex").slice(0, 16);
const python = join(homedir(), ".cache/ggsafe-streamlit", hash, "venv/bin/python");
const subjects = [], errors = [], report = [];
function support(subject, action, extra = {}) {
  const output = spawnSync(python, ["-m", "tests_streamlit.browser_support"], { input: JSON.stringify({ subject, action, ...extra }), encoding: "utf8" });
  if (output.status) throw new Error("합성 테스트 준비에 실패했어요.");
  return JSON.parse(output.stdout);
}
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  for (const width of [320, 360, 390, 558, 1440]) {
    const height = width === 360 ? 640 : 740;
    const subject = `synthetic-streamlit-${randomUUID()}`; subjects.push(subject);
    const who = support(subject, "identity");
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 760, hasTouch: true });
    await context.addCookies([{ name: "_streamlit_user", value: who.cookie, url: base, httpOnly: true, sameSite: "Lax" }]);
    await context.addInitScript(() => {
      if (window === window.top) {
        window.__actions = [];
        window.addEventListener("message", event => {
          if (event.data?.type === "streamlit:setComponentValue") window.__actions.push(event.data.value.action);
        });
      } else {
        let storageRequest;
        window.parent.addEventListener("message", event => {
          if (event.source === window && event.data?.type === "streamlit:setComponentValue" && event.data.value?.action === "storage") storageRequest = event.data.value.id;
        });
        // 실제로 저장됐으나 완료 응답만 유실된 상황. 재시도는 같은 메타데이터 한 건이어야 한다.
        window.addEventListener("message", event => {
          const reply = event.data?.args?.reply;
          if (window.__failEmailSave && reply?.value?.history_id) {
            reply.value.history_saved = false; window.__failEmailSave = false;
          }
          // 안내 UI만 합성 실패로 확인한다. 실제 보관 연결·비밀 설정은 바꾸지 않는다.
          if (window.__showStorageFailure && event.data?.args?.session) {
            event.data.args.session.storage_ready = false;
            event.data.args.session.storage_error = "검사 이력을 오래 보관할 연결이 아직 준비되지 않았어요. 운영자에게 알려 주세요.";
            if (reply?.id && reply.id === storageRequest) {
              reply.ok = false; reply.status = 503; reply.error = "보관 연결을 확인하지 못했어요.";
              delete reply.value;
            }
          }
        });
      }
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    const frame = page.frameLocator('iframe[title$=".ui"]');
    await frame.locator(".gg-app").waitFor();
    const component = page.frames().find(item => item.url().includes("/component/"));
    async function fitted() {
      await component.waitForFunction(() => Math.abs(innerHeight - document.getElementById("root").getBoundingClientRect().height) < 3);
      assert.equal(await component.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    async function nav(title) {
      await frame.locator(".gg-navigation:visible,.gg-mobile-nav:visible").getByRole("link", { name: title, exact: true }).click();
      await fitted();
    }
    await fitted();
    const shell = await frame.locator(".gg-app").boundingBox();
    assert.ok(shell && shell.width <= 431);
    assert.equal(await frame.locator(".gg-sidebar:visible").count(), 0);
    assert.equal(await frame.locator(".gg-mobile-nav:visible").count(), 1);
    await page.screenshot({ path: `/tmp/opencode/ggsafe-phone-home-${width}.png` });
    assert.equal(await page.locator('iframe[title$=".ui"]').getAttribute("scrolling"), "no");
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: Math.min(width / 2, 400), y: 620 }] });
    for (let y = 600; y >= 180; y -= 30) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.min(width / 2, 400), y }] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('[data-testid="stMain"]').scrollTop > 100);
    // 아래쪽에서 휠을 계속 굴려도 iframe 안에 갇히지 않고 마지막 안내에 닿는다.
    await page.mouse.move(Math.min(width / 2, 400), 580);
    await page.mouse.wheel(0, 10000);
    await page.waitForFunction(() => { const el = document.querySelector('[data-testid="stMain"]'); return el.scrollTop + el.clientHeight >= el.scrollHeight - 5; });
    const footer = await frame.locator(".gg-footer").boundingBox();
    assert.ok(footer && footer.y >= 0 && footer.y + footer.height <= height + 2);
    await nav("보안 검사");
    support(subject, "seed", { count: 12 });
    await component.evaluate(() => { window.__failEmailSave = true; });
    await frame.getByRole("checkbox", { name: /이메일 주소의 외부 전송에 동의해요/ }).check();
    await frame.getByRole("checkbox", { name: /이메일 원문 없이 검사 이력을 저장해요/ }).check();
    await frame.getByRole("button", { name: "내 이메일 검사하기", exact: true }).click();
    const retry = frame.getByRole("button", { name: "이메일 이력 저장 다시 시도", exact: true });
    try { await retry.waitFor(); }
    catch (error) {
      await page.screenshot({ path: "/tmp/opencode/ggsafe-mobile-failure.png" });
      console.error((await frame.locator("body").innerText()).slice(-1800));
      throw error;
    }
    await fitted();
    assert.equal(support(subject, "rows").length, 1);
    await retry.click();
    await frame.getByText("이메일 원문 없이 검사 이력을 저장했어요.", { exact: true }).waitFor();
    assert.equal(support(subject, "rows").length, 1);
    const actions = await page.evaluate(() => window.__actions);
    assert.equal(actions.filter(action => action === "email").length, 1);
    assert.equal(actions.filter(action => action === "email_save").length, 1);
    await frame.getByRole("searchbox", { name: "유출 서비스 검색", exact: true }).fill("없는 예시");
    await fitted();
    await nav("검사 이력");
    await frame.locator(".gg-history-table tbody tr").waitFor();
    await fitted();
    await page.screenshot({ path: `/tmp/opencode/ggsafe-mobile-history-${width}.png` });
    const row = frame.locator(".gg-history-table tbody tr").first();
    assert.equal(await row.locator("[data-label]").count(), 4);
    const rowBox = await row.boundingBox();
    assert.ok(rowBox && rowBox.width <= shell.width);
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/opencode/ggsafe-phone-history-card-${width}.png` });
    await component.evaluate(() => { window.__showStorageFailure = true; });
    await frame.getByRole("button", { name: "새로고침", exact: true }).click();
    const notice = frame.getByRole("region", { name: "검사 이력 보관 연결이 필요해요", exact: true });
    await notice.waitFor(); await fitted();
    const noticeBox = await notice.boundingBox();
    assert.ok(noticeBox && noticeBox.width <= shell.width - 30);
    await frame.getByRole("button", { name: "보관 연결 다시 확인", exact: true }).click();
    await notice.getByRole("status").getByText("아직 연결되지 않았어요.", { exact: false }).waitFor();
    await fitted();
    await notice.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/opencode/ggsafe-phone-storage-${width}.png` });
    assert.equal(await frame.getByRole("button", { name: "Google 계정 연결됨", exact: true }).count(), 1);
    await component.evaluate(() => { window.__showStorageFailure = false; });
    await frame.getByRole("button", { name: "보관 연결 다시 확인", exact: true }).click();
    await notice.waitFor({ state: "detached" }); await fitted();
    await frame.getByRole("button", { name: "Google 계정 연결됨", exact: true }).click();
    await frame.getByRole("dialog").waitFor();
    await frame.getByRole("button", { name: "창 닫기", exact: true }).click();
    await nav("해결 가이드"); await fitted();
    await page.screenshot({ path: `/tmp/opencode/ggsafe-mobile-guide-${width}.png` });
    if (width === 390) {
      await page.setViewportSize({ width: 768, height: 432 });
      await fitted();
      await frame.getByRole("button", { name: "Google 계정 연결됨", exact: true }).click();
      await frame.getByRole("button", { name: "로그아웃", exact: true }).scrollIntoViewIfNeeded();
      const logout = await frame.getByRole("button", { name: "로그아웃", exact: true }).boundingBox();
      assert.ok(logout && logout.y >= 0 && logout.y + logout.height <= 434);
      await frame.getByRole("button", { name: "창 닫기", exact: true }).click();
      await page.screenshot({ path: "/tmp/opencode/ggsafe-mobile-landscape.png" });
      await page.setViewportSize({ width: 390, height: 740 });
      await fitted();
    }
    report.push({ width, height, phone_only: true, touch_scroll: true, footer_reachable: true, dynamic_height: true, email_save_retry: true, duplicate_history: false, history_card: true, storage_notice_retry: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  for (const subject of subjects) support(subject, "cleanup");
}
