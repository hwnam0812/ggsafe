import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { withSecurityStorageRetry as retry, temporarySecurityStorageError as temporary } from "../worker/security-storage.ts";
import { databaseGoogleSessions } from "../scripts/google-session-store.mjs";

test("짧은 저장소 잠금은 정해진 간격으로만 재시도한다", async () => {
  const pauses = []; let calls = 0;
  const result = await retry(async () => {
    if (++calls < 3) throw new Error("SQLITE_BUSY: database is locked");
    return 42;
  }, async milliseconds => { pauses.push(milliseconds); });
  assert.equal(result, 42); assert.equal(calls, 3); assert.deepEqual(pauses, [25, 60]);
});

test("계속 잠겨 있어도 네 번을 넘겨 재시도하지 않는다", async () => {
  const pauses = []; let calls = 0;
  await assert.rejects(retry(async () => { calls++; throw new Error("Failed to get session commit token"); }, async milliseconds => { pauses.push(milliseconds); }));
  assert.equal(calls, 5); assert.deepEqual(pauses, [25, 60, 120, 220]);
});

test("잘못된 요청이나 일반 오류는 반복하지 않는다", async () => {
  for (const error of [new Error("Duplicate session"), new Error("D1_ERROR: missing table"), new Error("network failure")]) {
    let calls = 0;
    await assert.rejects(retry(async () => { calls++; throw error; }, async () => assert.fail("불필요한 재시도")));
    assert.equal(calls, 1);
  }
});

test("중첩 원인의 일시적 잠금을 구분하고 순환 원인에서도 멈춘다", () => {
  assert.equal(temporary(new Error("outer", { cause: new Error("SQLITE_BUSY") })), true);
  const error = new Error("normal failure"); error.cause = error;
  assert.equal(temporary(error), false); assert.equal(temporary(null), false);
});

function sessionStore({ failAfterInsert = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  let failed = false, inserts = 0;
  const db = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    return { bind(...values) { return {
      async first() {
        const row = statement.get(...values) ?? null;
        if (sql.startsWith("INSERT INTO security_account_sessions")) {
          inserts++;
          if (failAfterInsert && !failed) { failed = true; throw new Error("Failed to get session commit token"); }
        }
        return row;
      },
      async run() { return statement.run(...values); },
    }; } };
  } };
  return { sqlite, store: databaseGoogleSessions(db), insertCalls: () => inserts };
}
const synthetic = {
  owner_key: `google:v1:${"b".repeat(64)}`, email_hash: "c".repeat(64), csrf_hash: "d".repeat(64),
  private_json: "synthetic-protected-session-only", expires_at: Date.now() + 72 * 60 * 60_000,
};

test("로그인 연결 저장 후 응답만 실패해도 중복이나 덮어쓰기 없이 복구한다", async () => {
  const f = sessionStore({ failAfterInsert: true }), id = "a".repeat(64);
  await f.store.insert(id, synthetic);
  assert.equal(f.insertCalls(), 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS total FROM security_account_sessions").get().total, 1);
  const row = await f.store.get(id, Date.now());
  assert.equal(row.owner_key, synthetic.owner_key); assert.equal(row.private_json, synthetic.private_json);
});

test("같은 앱 키에 다른 계정 연결이 있으면 저장 재시도로도 덮어쓰지 않는다", async () => {
  const f = sessionStore(), id = "a".repeat(64);
  await f.store.insert(id, synthetic);
  await assert.rejects(f.store.insert(id, { ...synthetic, owner_key: `google:v1:${"e".repeat(64)}`, private_json: "different-synthetic-session" }), /Duplicate/);
  assert.equal((await f.store.get(id, Date.now())).owner_key, synthetic.owner_key);
});
