import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createAccountPreview, previewBase as base, sessionStorageName } from "./account-preview-fixture.mjs";

const fixture = await createAccountPreview(), report = [];
const hash = value => createHash("sha256").update(value).digest("hex");
async function sessionRow(who) {
  return fixture.db.prepare("SELECT token_hash, expires_at FROM security_account_sessions WHERE owner_key = ? ORDER BY expires_at DESC LIMIT 1").bind(fixture.owner(who)).first();
}
async function count(who) {
  return (await fixture.db.prepare("SELECT (SELECT COUNT(*) FROM security_history WHERE owner_key = ?) + (SELECT COUNT(*) FROM security_password_history WHERE owner_key = ?) AS total").bind(fixture.owner(who), fixture.owner(who)).first()).total;
}

try {
  for (const width of [1440, 558, 383]) {
    const a = fixture.identity(`account-a-${width}`), b = fixture.identity(`account-b-${width}`);
    const control = await fixture.newContext({ who: a, width }), { context } = control;
    let page = await context.newPage(); page.setDefaultTimeout(12000);
    const errors = [], saved = [];
    const watch = value => value.on("pageerror", error => errors.push(error.message)); watch(page);
    let rangeCalls = 0, suffix = "";
    await context.route("https://api.pwnedpasswords.com/range/*", async route => {
      rangeCalls++;
      const headers = await route.request().allHeaders();
      for (const name of ["x-ggsafe-session", "x-ggsafe-csrf", "cookie", "referer"]) assert.equal(headers[name], undefined);
      await route.fulfill({ contentType: "text/plain", body: `${suffix}:23456\r\n${"B".repeat(35)}:0` });
    });
    await context.route("**/api/security/**", async route => {
      const request = route.request(), headers = await request.allHeaders(); delete headers.cookie;
      if (request.url().endsWith("/history/password") && request.method() === "POST") saved.push(JSON.parse(request.postData()));
      await route.continue({ headers });
    });

    // 로그인 전에는 주소를 직접 열어도 내부 화면·입력란·기록이 없어야 한다.
    for (const path of ["/", "/scan?tab=password", "/history"]) {
      await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Google로 로그인", exact: true }).waitFor();
      assert.equal(await page.locator(".gg-workspace,input[type=password],.gg-history-table").count(), 0);
    }
    assert.equal((await context.request.get(`${base}/api/security/history`)).status(), 401);

    await fixture.login(page);
    await page.goto(`${base}/scan`, { waitUntil: "networkidle" });
    assert.match(await page.locator(".gg-inspection-intro").innerText(), /로그인한 주소만 검사/);
    assert.equal(await page.getByText("Google 연결 없이도 검사할 수 있어요.", { exact: false }).count(), 0);
    assert.equal(await page.locator('input[type="email"]').count(), 0);
    assert.equal(await page.locator(".gg-verified-email").innerText(), a.email);
    assert.equal(await page.getByRole("checkbox", { name: /이메일 주소의 외부 전송에 동의해요/ }).isChecked(), false);
    await page.getByRole("button", { name: "내 이메일 검사하기", exact: true }).click();
    await page.getByRole("alert").waitFor(); assert.equal(await count(a), 0);
    await fixture.seedEmail(a);
    await page.getByRole("checkbox", { name: /이메일 주소의 외부 전송에 동의해요/ }).check();
    await page.getByRole("checkbox", { name: /이메일 원문 없이 검사 이력을 저장해요/ }).check();
    await page.getByRole("button", { name: "내 이메일 검사하기", exact: true }).click();
    await page.getByText("이메일 원문 없이 검사 이력을 저장했어요.", { exact: true }).waitFor();

    // 화면을 우회해 다른 이메일을 보내도 실제 검사 처리기가 거절한다.
    const status = await page.evaluate(async name => {
      const saved = JSON.parse(localStorage.getItem(name));
      const session = await (await fetch("/api/preview-google/session", { headers: { "x-ggsafe-session": saved.key } })).json();
      return (await fetch("/api/security/email", { method: "POST", headers: { "content-type": "application/json", "x-ggsafe-session": saved.key, "x-ggsafe-csrf": session.csrf }, body: JSON.stringify({ email: "not-the-signed-in-user@example.com", consent: true, save_history: true }) })).status;
    }, sessionStorageName);
    assert.equal(status, 403); assert.equal(await count(a), 1);
    await page.screenshot({ path: `/tmp/opencode/ggsafe-account-fixed-email-${width}.png`, fullPage: true });

    await page.goto(`${base}/scan?tab=password`, { waitUntil: "networkidle" });
    const password = `GGSAFE synthetic account test ${randomUUID()}`;
    const fullHash = createHash("sha1").update(password).digest("hex").toUpperCase(); suffix = fullHash.slice(5);
    await page.getByLabel("검사할 비밀번호", { exact: false }).fill(password);
    await page.getByRole("checkbox", { name: /변환값 앞 5글자의 외부 전송에 동의해요/ }).check();
    await page.getByRole("button", { name: "비밀번호 검사하기", exact: true }).click();
    await page.getByText("검사 이력 저장됨", { exact: true }).waitFor(); assert.equal(await count(a), 2);
    assert.deepEqual(Object.keys(saved[0]).sort(), ["checked_at", "count", "id", "status"]);
    const local = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    for (const secret of [a.email, a.subject, password, fullHash]) assert.ok(!local.includes(secret) && !JSON.stringify(saved).includes(secret));

    await page.goto(`${base}/history`, { waitUntil: "networkidle" });
    assert.equal(await page.locator(".gg-history-table tbody tr").count(), 2);
    await page.screenshot({ path: `/tmp/opencode/ggsafe-account-history-${width}.png`, fullPage: true });

    // 같은 계정의 별도 브라우저는 기록을 공유하고, 다른 계정은 빈 이력이다.
    const same = await fixture.newContext({ who: a, width }), samePage = await same.context.newPage();
    await samePage.goto(`${base}/history`, { waitUntil: "networkidle" }); await fixture.login(samePage);
    await samePage.locator(".gg-history-table tbody tr").first().waitFor();
    assert.equal(await samePage.locator(".gg-history-table tbody tr").count(), 2);
    const different = await fixture.newContext({ who: b, width }), otherPage = await different.context.newPage();
    await otherPage.goto(`${base}/history`, { waitUntil: "networkidle" }); await fixture.login(otherPage);
    await otherPage.getByRole("heading", { name: "아직 저장한 검사 이력이 없어요", exact: true }).waitFor();

    // 기존 계정의 조회 응답을 늦게 보내도 새 계정 화면에 나타나지 않는다.
    let holdNext = true, release, entered;
    const holding = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
    let finished; const completed = new Promise(resolve => { finished = resolve; });
    await context.route("**/api/security/history", async route => {
      if (holdNext && route.request().method() === "GET") {
        holdNext = false; const response = await route.fetch(); entered(); await held;
        try { await route.fulfill({ response }); } finally { finished(); }
      } else await route.fallback();
    });
    await page.getByRole("button", { name: "새로고침", exact: true }).click(); await holding;
    control.select(b);
    await page.getByRole("button", { name: "Google 계정 연결됨", exact: true }).click();
    await page.getByRole("button", { name: "다른 계정으로 연결", exact: true }).click();
    await page.getByRole("button", { name: "시험용 Google 계정으로 계속", exact: true }).click();
    await page.getByRole("heading", { name: "아직 저장한 검사 이력이 없어요", exact: true }).waitFor();
    release(); await completed;
    assert.equal(await page.locator(".gg-history-table tbody tr").count(), 0);
    assert.equal(await count(a), 2); assert.equal(await count(b), 0);
    await page.goto(`${base}/scan`, { waitUntil: "networkidle" });
    assert.equal(await page.locator(".gg-verified-email").innerText(), b.email);
    assert.equal(await page.getByRole("checkbox", { name: /이메일 주소의 외부 전송에 동의해요/ }).isChecked(), false);
    assert.equal(await page.getByRole("checkbox", { name: /이메일 원문 없이 검사 이력을 저장해요/ }).isChecked(), false);
    assert.equal(await page.locator(".gg-result").count(), 0);

    // 앱 연결 정보가 남은 브라우저를 다시 열면 로그인 조작 없이 자기 기록을 복구한다.
    const state = await same.context.storageState(); await same.context.close();
    const reopened = await fixture.newContext({ who: a, width, storageState: state }), reopenedPage = await reopened.context.newPage();
    await reopenedPage.goto(`${base}/history`, { waitUntil: "networkidle" });
    await reopenedPage.locator(".gg-history-table tbody tr").first().waitFor();
    assert.equal(await reopenedPage.locator(".gg-history-table tbody tr").count(), 2);

    // 자동 상태 확인만 반복해도 기한은 바뀌지 않는다.
    const idleBefore = (await sessionRow(a)).expires_at;
    await reopenedPage.evaluate(async name => {
      const { key } = JSON.parse(localStorage.getItem(name));
      for (let i = 0; i < 3; i++) await fetch("/api/preview-google/session", { headers: { "x-ggsafe-session": key } });
    }, sessionStorageName);
    assert.equal((await sessionRow(a)).expires_at, idleBefore);

    // 본인 기록 삭제의 취소와 실행은 다른 계정에 영향을 주지 않는다.
    await reopenedPage.getByRole("button", { name: "기록 삭제", exact: true }).click();
    await reopenedPage.getByRole("button", { name: "취소", exact: true }).click(); assert.equal(await count(a), 2);
    await reopenedPage.getByRole("button", { name: "기록 삭제", exact: true }).click();
    await reopenedPage.getByRole("button", { name: "검사 이력 삭제", exact: true }).click();
    await reopenedPage.getByRole("heading", { name: "아직 저장한 검사 이력이 없어요", exact: true }).waitFor();
    assert.equal(await count(a), 0); assert.equal(await count(b), 0);

    // 만료된 서버 연결은 화면에 남은 비밀번호도 외부로 조회하기 전에 막는다.
    await page.goto(`${base}/scan?tab=password`, { waitUntil: "networkidle" });
    await page.getByLabel("검사할 비밀번호", { exact: false }).fill("GGSAFE synthetic expired session");
    const activity = page.waitForResponse(response => response.url().endsWith("/api/preview-google/activity") && response.ok());
    await page.getByRole("checkbox", { name: /변환값 앞 5글자의 외부 전송에 동의해요/ }).check(); await activity;
    const { key } = await page.evaluate(name => JSON.parse(localStorage.getItem(name)), sessionStorageName);
    await fixture.db.prepare("UPDATE security_account_sessions SET expires_at = ? WHERE token_hash = ?").bind(Date.now() - 1, hash(key)).run();
    const beforeExpired = rangeCalls;
    await page.getByRole("button", { name: "비밀번호 검사하기", exact: true }).click();
    await page.getByRole("button", { name: "Google로 로그인", exact: true }).waitFor();
    assert.equal(rangeCalls, beforeExpired); assert.equal(await page.locator('input[type="password"],.gg-history-table').count(), 0);

    // 직접 로그아웃은 현재 브라우저를 바로 잠그고 저장한 기록을 없애지 않는다.
    await reopenedPage.getByRole("button", { name: "Google 계정 연결됨", exact: true }).click();
    await reopenedPage.getByRole("button", { name: "로그아웃", exact: true }).click();
    await reopenedPage.getByRole("button", { name: "Google로 로그인", exact: true }).waitFor();
    assert.equal(await reopenedPage.locator(".gg-workspace").count(), 0);
    await reopenedPage.reload({ waitUntil: "networkidle" });
    await reopenedPage.getByRole("button", { name: "Google로 로그인", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    report.push({ width, login_gate: true, verified_email_only: true, tampered_email_rejected: true, account_isolation: true, same_account_other_browser: true, browser_restart: true, late_response_isolated: true, automatic_reads_do_not_extend: true, expired_password_lookup_blocked: true, logout_gate: true, metadata_only: true, no_overflow: true, page_errors: 0 });
    await context.close(); await different.context.close(); await reopened.context.close();
  }
  console.log(JSON.stringify(report));
} finally { await fixture.close(); }
