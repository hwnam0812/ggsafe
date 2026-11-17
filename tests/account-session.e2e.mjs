import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createAccountPreview, previewBase as base, sessionStorageName } from "./account-preview-fixture.mjs";

const fixture = await createAccountPreview();
const hash = value => createHash("sha256").update(value).digest("hex");
const ttl = 72 * 60 * 60_000;
let releaseSession;
try {
  const who = fixture.identity("session-events"), { context } = await fixture.newContext({ who });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/history`, { waitUntil: "networkidle" }); await fixture.login(page);
  await page.getByRole("heading", { name: "아직 저장한 검사 이력이 없어요", exact: true }).waitFor();
  const saved = () => page.evaluate(name => JSON.parse(localStorage.getItem(name)), sessionStorageName);
  const row = async () => fixture.db.prepare("SELECT expires_at FROM security_account_sessions WHERE token_hash = ?").bind(hash((await saved()).key)).first();

  // 자동 상태 조회와 스크립트로 보낸 가짜 조작은 기한을 연장하지 않는다.
  let activityCalls = 0;
  context.on("request", request => { if (request.url().endsWith("/api/preview-google/activity")) activityCalls++; });
  const idleBefore = (await row()).expires_at;
  await page.evaluate(async name => {
    const { key } = JSON.parse(localStorage.getItem(name));
    await fetch("/api/preview-google/session", { headers: { "x-ggsafe-session": key } });
    window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 10, bubbles: true }));
  }, sessionStorageName);
  await page.waitForTimeout(1000); // 800ms의 실제 조작 수집 구간이 지나도 자동 요청이 없는지 본다.
  assert.equal(activityCalls, 0); assert.equal((await row()).expires_at, idleBefore);

  // 실제 클릭은 72시간으로 연장한다. 자동 조회는 이후에도 같은 기한을 유지한다.
  const event = page.waitForResponse(response => response.url().endsWith("/api/preview-google/activity") && response.ok());
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  const extended = await (await event).json(), expiry = Date.parse(extended.expires_at);
  assert.ok(expiry > idleBefore); assert.ok(Math.abs(expiry - Date.now() - ttl) < 5000);
  assert.equal((await row()).expires_at, expiry);
  await page.evaluate(async name => {
    const { key } = JSON.parse(localStorage.getItem(name));
    await fetch("/api/preview-google/session", { headers: { "x-ggsafe-session": key } });
  }, sessionStorageName);
  assert.equal((await row()).expires_at, expiry);

  // 같은 브라우저의 다른 탭에서 로그아웃하면 이 탭도 기록 화면을 바로 닫는다.
  const other = await context.newPage();
  await other.goto(`${base}/history`, { waitUntil: "networkidle" });
  await other.getByRole("heading", { name: "아직 저장한 검사 이력이 없어요", exact: true }).waitFor();
  await other.getByRole("button", { name: "Google 계정 연결됨", exact: true }).click();
  await other.getByRole("button", { name: "로그아웃", exact: true }).click();
  await other.getByRole("button", { name: "Google로 로그인", exact: true }).waitFor();
  await page.getByRole("button", { name: "Google로 로그인", exact: true }).waitFor();
  assert.equal(await page.locator(".gg-workspace").count(), 0); await other.close();

  await fixture.login(page);
  await page.getByRole("heading", { name: "아직 저장한 검사 이력이 없어요", exact: true }).waitFor();
  // 합성 계정에만 완료 기록을 만들어, 만료 시 기록이 실제로 화면에서 사라지는지 확인한다.
  await page.evaluate(async ({ name, id }) => {
    const { key } = JSON.parse(localStorage.getItem(name));
    const session = await (await fetch("/api/preview-google/session", { headers: { "x-ggsafe-session": key } })).json();
    const response = await fetch("/api/security/history/password", { method: "POST", headers: { "content-type": "application/json", "x-ggsafe-session": key, "x-ggsafe-csrf": session.csrf }, body: JSON.stringify({ id, status: "not_found", count: 0, checked_at: new Date().toISOString() }) });
    if (!response.ok) throw new Error("합성 이력 준비 실패");
  }, { name: sessionStorageName, id: randomUUID() });
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page.locator(".gg-history-table tbody tr").waitFor();
  // 앞선 실제 조작 연장이 끝난 뒤 읽기 요청만 지연한다.
  await page.waitForTimeout(1000);
  let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { releaseSession = resolve; });
  await context.route("**/api/preview-google/session", async route => { entered(); await held; await route.fallback(); });
  await page.evaluate(name => window.dispatchEvent(new StorageEvent("storage", { key: name })), sessionStorageName);
  await waiting;
  const current = await saved();
  await fixture.db.prepare("UPDATE security_account_sessions SET expires_at = ? WHERE token_hash = ?").bind(Date.now() - 1, hash(current.key)).run();
  await page.evaluate(name => {
    const value = JSON.parse(localStorage.getItem(name)); value.expires = Date.now() - 1;
    localStorage.setItem(name, JSON.stringify(value));
  }, sessionStorageName);
  releaseSession();
  await page.getByRole("button", { name: "Google로 로그인", exact: true }).waitFor();
  assert.equal(await page.locator(".gg-workspace,.gg-history-table").count(), 0);
  assert.equal(await saved(), null); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ untrusted_events_do_not_extend: true, automatic_reads_do_not_extend: true, trusted_click_extends_72_hours: true, other_tab_logout_locks: true, expiry_during_response_locks: true, page_errors: 0 }));
} finally { releaseSession?.(); await fixture.close(); }
