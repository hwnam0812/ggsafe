// 실행 중인 미리보기만 검사한다. 모든 비밀번호·이메일과 외부 응답은 합성 데이터다.
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createAccountPreview, previewBase as base } from "./account-preview-fixture.mjs";
const savePath = "/api/security/history/password";
const fixture = await createAccountPreview(), { browser, query: sql } = fixture;
const report = [];
try {
  for (const width of [1440, 558, 383]) {
    const who = fixture.identity(`password-${width}`), { context } = await fixture.newContext({ who, width });
    const entries = [], errors = [], secrets = [];
    let mode = "found", rangeCalls = 0, releaseRange, suffix = "", failSaveResponse = false;
    await context.route("**/api/security/**", async route => {
      const request = route.request(), headers = await request.allHeaders(); delete headers.cookie;
      const saving = request.url().endsWith(savePath) && request.method() === "POST";
      if (saving) entries.push(JSON.parse(request.postData()));
      const response = await route.fetch({ headers });
      const outgoing = response.headers(); delete outgoing["set-cookie"];
      if (saving && failSaveResponse) {
        failSaveResponse = false;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ history_saved: false }) });
      } else await route.fulfill({ response, headers: outgoing });
    });
    await context.route("https://api.pwnedpasswords.com/range/*", async route => {
      rangeCalls++;
      assert.equal(route.request().headers()["add-padding"], "true");
      assert.equal(route.request().headers().cookie, undefined);
      if (mode === "hold") await new Promise(resolve => { releaseRange = resolve; });
      try {
        if (mode === "error") await route.fulfill({ status: 503, contentType: "text/plain", body: "unavailable" });
        else await route.fulfill({ status: 200, contentType: "text/plain", body: `${mode === "found" ? suffix : "A".repeat(35)}:12345\r\n${"B".repeat(35)}:0` });
      } catch { /* 취소한 조회는 저장하지 않는다. */ }
    });
    let page = await context.newPage(); page.setDefaultTimeout(10000);
    const watch = p => p.on("pageerror", error => errors.push(error.message)); watch(page);
    const open = () => page.goto(`${base}/scan?tab=password`, { waitUntil: "networkidle" });
    async function prepare() {
      const password = `GGSAFE synthetic test ${randomUUID()}`;
      const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
      suffix = hash.slice(5); secrets.push(password, hash);
      await page.getByLabel("검사할 비밀번호", { exact: false }).fill(password);
    }
    async function run() {
      await prepare();
      await page.getByRole("checkbox", { name: /변환값 앞 5글자의 외부 전송에 동의해요/ }).check();
      await page.getByRole("button", { name: "비밀번호 검사하기", exact: true }).click();
    }
    await open(); await fixture.login(page); await prepare();
    await page.getByRole("button", { name: "비밀번호 검사하기", exact: true }).click();
    await page.getByRole("alert").waitFor(); assert.equal(rangeCalls, 0); assert.equal(entries.length, 0);
    await page.getByRole("checkbox", { name: /변환값 앞 5글자의 외부 전송에 동의해요/ }).check();
    await page.getByRole("button", { name: "비밀번호 검사하기", exact: true }).click();
    await page.getByText("검사 이력 저장됨", { exact: true }).waitFor(); assert.equal(entries.length, 1);
    const entry = entries[0]; assert.deepEqual(Object.keys(entry).sort(), ["checked_at", "count", "id", "status"]);
    const saved = await sql(`SELECT * FROM security_password_history WHERE id='${entry.id}'`);
    assert.equal(saved.length, 1); assert.equal(saved[0].breach_count, 12345); assert.equal(saved[0].status, "breached");
    assert.deepEqual(Object.keys(saved[0]).sort(), ["breach_count", "checked_at", "created_at", "id", "owner_key", "status"]);
    await page.screenshot({ path: `/tmp/opencode/ggsafe-password-saved-${width}.png`, fullPage: true });
    await page.getByRole("link", { name: "검사 이력 보기", exact: true }).click();
    await page.locator(".gg-history-table tbody tr").waitFor();
    assert.equal(await page.locator(".gg-history-table tbody tr").count(), 1);
    assert.ok((await page.locator(".gg-history-table").innerText()).includes("12,345회"));
    await page.reload({ waitUntil: "networkidle" }); assert.equal(await page.locator(".gg-history-table tbody tr").count(), 1);
    await page.close(); page = await context.newPage(); watch(page);
    await page.goto(`${base}/history`, { waitUntil: "networkidle" }); assert.equal(await page.locator(".gg-history-table tbody tr").count(), 1);
    await page.goto(base, { waitUntil: "networkidle" });
    assert.ok((await page.locator(".gg-metrics").innerText()).includes("12,345회"));
    assert.ok((await page.locator(".gg-history-preview").innerText()).includes("비밀번호 유출 검사"));

    mode = "not_found"; await open(); await run();
    await page.getByText("검사 이력 저장됨", { exact: true }).waitFor(); assert.equal(entries.length, 2); assert.equal(entries[1].count, 0);
    await page.getByRole("link", { name: "검사 이력 보기", exact: true }).click();
    await page.locator(".gg-history-table tbody tr").first().waitFor(); assert.equal(await page.locator(".gg-history-table tbody tr").count(), 2);
    await page.getByRole("button", { name: "검사 미완료", exact: true }).click();
    await page.getByRole("heading", { name: "해당하는 검사 기록이 없어요", exact: true }).waitFor();
    await page.getByRole("button", { name: "전체", exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `/tmp/opencode/ggsafe-password-history-${width}.png`, fullPage: true });

    mode = "error"; await open(); await run();
    await page.getByRole("heading", { name: "검사를 완료하지 못했어요", exact: true }).waitFor(); assert.equal(entries.length, 2);
    mode = "hold"; await open(); await run();
    await page.getByRole("button", { name: "검사 중단", exact: true }).click(); releaseRange?.();
    await page.getByRole("heading", { name: "검사를 완료하지 못했어요", exact: true }).waitFor(); assert.equal(entries.length, 2);

    // 결과는 저장됐지만 응답을 확인하지 못한 상황: 재시도는 외부 재조회·중복 저장 없이 끝나야 한다.
    mode = "found"; failSaveResponse = true; await open(); await run();
    await page.getByRole("button", { name: "이력 저장 다시 시도", exact: true }).waitFor();
    assert.equal(await page.getByText("검사 이력 저장됨", { exact: true }).count(), 0);
    const beforeRetry = rangeCalls;
    await page.getByRole("button", { name: "이력 저장 다시 시도", exact: true }).click();
    await page.getByText("검사 이력 저장됨", { exact: true }).waitFor();
    assert.equal(rangeCalls, beforeRetry); assert.equal(entries[2].id, entries[3].id);
    assert.equal((await sql(`SELECT count(*) AS total FROM security_password_history WHERE id='${entries[2].id}'`))[0].total, 1);

    // 기존 이메일 저장도 실제 경로로 실행하고 두 검사가 섞여도 각각 올바르게 표시되는지 본다.
    const email = who.email;
    const emailHash = createHash("sha256").update(email).digest("hex");
    const cached = { status: "not_found", message: "합성 응답이에요.", breach_count: 0, breaches: [], source: "테스트 전용", checked_at: new Date().toISOString(), cached: false };
    await sql(`INSERT INTO security_cache (email_hash,result_json,expires_at) VALUES ('${emailHash}','${JSON.stringify(cached)}',${Math.floor(Date.now()/1000)+300})`);
    await page.goto(`${base}/scan`, { waitUntil: "networkidle" });
    assert.equal(await page.locator('input[type="email"]').count(), 0);
    assert.equal(await page.locator(".gg-verified-email").innerText(), email);
    await page.getByRole("checkbox", { name: /이메일 주소의 외부 전송에 동의해요/ }).check();
    await page.getByRole("checkbox", { name: /이메일 원문 없이 검사 이력을 저장해요/ }).check();
    await page.getByRole("button", { name: "내 이메일 검사하기", exact: true }).click();
    await page.getByText("이메일 원문 없이 검사 이력을 저장했어요.", { exact: true }).waitFor();
    await page.goto(`${base}/history`, { waitUntil: "networkidle" });
    assert.equal(await page.locator(".gg-history-table tbody tr").count(), 4);
    assert.equal(await page.locator(".gg-history-table tbody tr").filter({ hasText: "이메일 유출 검사" }).count(), 1);
    assert.equal(await page.locator(".gg-history-table tbody tr").filter({ hasText: "비밀번호 유출 검사" }).count(), 3);
    await page.screenshot({ path: `/tmp/opencode/ggsafe-mixed-history-${width}.png`, fullPage: true });
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    for (const secret of [...secrets, email]) {
      assert.ok(!JSON.stringify(entries).includes(secret)); assert.ok(!JSON.stringify(saved).includes(secret)); assert.ok(!storage.includes(secret));
    }
    assert.ok(!storage.includes("breach_count"));
    const other = await browser.newContext(), isolated = await other.newPage();
    await isolated.goto(`${base}/history`, { waitUntil: "networkidle" });
    await isolated.getByRole("button", { name: "Google로 로그인", exact: true }).waitFor();
    assert.equal(await isolated.locator(".gg-history-table").count(), 0); await other.close();
    await page.getByRole("button", { name: "기록 삭제", exact: true }).click();
    await page.getByRole("button", { name: "취소", exact: true }).click(); assert.equal(await page.locator(".gg-history-table tbody tr").count(), 4);
    await page.getByRole("button", { name: "기록 삭제", exact: true }).click();
    await page.getByRole("button", { name: "검사 이력 삭제", exact: true }).click();
    await page.getByRole("heading", { name: "아직 저장한 검사 이력이 없어요", exact: true }).waitFor();
    assert.equal((await sql(`SELECT count(*) AS remaining FROM security_password_history WHERE id='${entry.id}'`))[0].remaining, 0);
    assert.deepEqual(errors, []);
    report.push({ width, login_required: true, auto_saved: true, real_storage: true, reload_reopen: true, correct_units: true, no_failed_or_cancelled_history: true, metadata_only: true, mixed_email_history: true, retry_without_lookup_or_duplicate: true, anonymous_blocked: true, delete_cancel_and_confirm: true, no_cookies: true, no_overflow: true, page_errors: 0 });
    await context.close();
  }
  console.log(JSON.stringify(report));
} finally { await fixture.close(); }
