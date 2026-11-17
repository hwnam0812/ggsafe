import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkPassword, passwordHash, parsePasswordRange, PasswordCheckError } from "../src/lib/password-check.ts";

// 검사 전용 합성 입력이다. 실제 사용자의 비밀번호나 저장된 환경 변수는 읽지 않는다.
const synthetic = "GGSAFE-합성-검사전용-2026! ";
const hash = createHash("sha1").update(synthetic, "utf8").digest("hex").toUpperCase();
const suffix = hash.slice(5);
const other = "F".repeat(35);
const textResponse = (text, status = 200) => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const range = (count = 7) => `${suffix}:${count}\r\n${other}:2\r\n${"0".repeat(35)}:0\r\n`;

test("한글·공백·대소문자를 바꾸지 않고 UTF-8 원문을 변환해요", async () => {
  for (const value of [synthetic, " ", "  password  ", "password", "Password", "가", "가", "🔑"])
    assert.equal(await passwordHash(value), createHash("sha1").update(value, "utf8").digest("hex").toUpperCase());
  assert.notEqual(await passwordHash("가"), await passwordHash("가"));
});
test("동의 없이는 변환·조회하지 않아요", async () => {
  let calls = 0;
  for (const consent of [false, undefined, "true", 1]) {
    await assert.rejects(checkPassword(synthetic, { consent, fetcher: async () => { calls++; return textResponse(range()); } }), PasswordCheckError);
  }
  assert.equal(calls, 0);
});
test("빈 입력·너무 긴 입력은 외부로 보내지 않아요", async () => {
  let calls = 0;
  for (const value of ["", "가".repeat(1025)]) await assert.rejects(checkPassword(value, { consent: true, fetcher: async () => { calls++; return textResponse(range()); } }), PasswordCheckError);
  assert.equal(calls, 0);
});
test("앞 5글자만 조회하고 원문·전체 해시·쿠키·연결 키는 보내지 않아요", async () => {
  const result = await checkPassword(synthetic, { consent: true, fetcher: async (url, options) => {
    assert.equal(url, `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    assert.equal(options.method, "GET"); assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, { "Add-Padding": "true", Accept: "text/plain" });
    assert.equal(options.credentials, "omit"); assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error");
    const outbound = JSON.stringify({ url, options });
    assert.ok(!outbound.includes(synthetic)); assert.ok(!outbound.includes(hash)); assert.ok(!outbound.includes(suffix));
    return textResponse(range());
  } });
  assert.equal(result.status, "found"); assert.equal(result.count, 7);
  assert.deepEqual(Object.keys(result).sort(), ["checked_at", "count", "status"]);
});
test("정상 미발견은 0으로 구분하고 padding의 0회는 발견으로 판단하지 않아요", async () => {
  assert.equal(parsePasswordRange(range(0), suffix), 0);
  assert.equal(parsePasswordRange(`${other}:2\n`, suffix), 0);
  assert.equal(parsePasswordRange(range().toLowerCase(), suffix), 7);
  const result = await checkPassword(synthetic, { consent: true, fetcher: async () => textResponse(range(0)) });
  assert.equal(result.status, "not_found"); assert.equal(result.count, 0);
});
for (const [label, text] of [
  ["빈 응답", ""], ["공백만", "\n "], ["HTML", "<html>오류</html>"], ["잘못된 숫자", `${suffix}:no`],
  ["음수", `${suffix}:-1`], ["소수", `${suffix}:1.5`], ["안전 정수 초과", `${suffix}:9007199254740992`],
  ["짧은 해시", "ABC:2"], ["잘못된 해시", `${"Z".repeat(35)}:2`], ["전체 해시", `${hash}:2`],
  ["중복 해시", `${suffix}:1\n${suffix}:2`], ["정상과 오류 혼합", `${suffix}:1\n깨진응답`],
  ["padding만", `${suffix}:0`], ["과도한 본문", "A".repeat(1024 * 1024 + 1)],
]) test(`${label}을 유출 미발견으로 처리하지 않아요`, () => assert.throws(() => parsePasswordRange(text, suffix), PasswordCheckError));

for (const status of [204, 301, 400, 403, 404, 429, 500, 503]) {
  test(`HTTP ${status}는 미발견이 아닌 조회 실패예요`, async () => {
    const response = status === 204 ? new Response(null, { status }) : textResponse(range(), status);
    await assert.rejects(checkPassword(synthetic, { consent: true, fetcher: async () => response }), error => error instanceof PasswordCheckError && !error.message.includes(synthetic));
  });
}
test("상태가 200이어도 잘못된 응답 형식이면 실패예요", async () => {
  await assert.rejects(checkPassword(synthetic, { consent: true, fetcher: async () => new Response(range(), { headers: { "content-type": "text/html" } }) }), PasswordCheckError);
  await assert.rejects(checkPassword(synthetic, { consent: true, fetcher: async () => textResponse("깨진 응답") }), PasswordCheckError);
});
test("조각으로 받은 응답도 읽고 최대 크기를 제한해요", async () => {
  const encoded = new TextEncoder().encode(range());
  const response = new Response(new ReadableStream({ start(c) { for (const byte of encoded) c.enqueue(Uint8Array.of(byte)); c.close(); } }), { headers: { "content-type": "text/plain" } });
  assert.equal((await checkPassword(synthetic, { consent: true, fetcher: async () => response })).count, 7);
  await assert.rejects(checkPassword(synthetic, { consent: true, fetcher: async () => textResponse("A".repeat(1024 * 1024 + 1)) }), PasswordCheckError);
});
test("외부 오류의 원문을 안내에 넣지 않아요", async () => {
  await assert.rejects(checkPassword(synthetic, { consent: true, fetcher: async () => { throw new Error(synthetic); } }), error => error instanceof PasswordCheckError && !error.message.includes(synthetic));
});
test("시작 전 취소하면 외부 요청이 없어요", async () => {
  let calls = 0; const controller = new AbortController(); controller.abort();
  await assert.rejects(checkPassword(synthetic, { consent: true, signal: controller.signal, fetcher: async () => { calls++; return textResponse(range()); } }), /중단/);
  assert.equal(calls, 0);
});
test("조회 중 취소는 요청에 전달되고 성공으로 바뀌지 않아요", async () => {
  const controller = new AbortController();
  const pending = checkPassword(synthetic, { consent: true, signal: controller.signal, fetcher: async (_url, options) => {
    controller.abort(); assert.equal(options.signal.aborted, true); return textResponse(range());
  } });
  await assert.rejects(pending, /중단/);
});
test("시간 초과는 정상 미발견이 아니에요", async () => {
  await assert.rejects(checkPassword(synthetic, { consent: true, timeoutMs: 5, fetcher: async (_url, options) => {
    await new Promise(resolve => setTimeout(resolve, 15)); options.signal.throwIfAborted(); return textResponse(range());
  } }), /조회 시간이/);
});
