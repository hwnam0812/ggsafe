import test from "node:test";
import assert from "node:assert/strict";
import { parseEmailResponse } from "../worker/security-response.ts";

// 모두 가상 응답이며 실제 계정·서비스의 유출 여부를 주장하지 않습니다.
const cases = [
  ["중첩 목록", 200, { breaches: [["예시서비스 A", "예시서비스 B"]] }, "breached", 2],
  ["공백 정리와 중복 제거", 200, { breaches: [[" 예시서비스 A ", "예시서비스 A"]] }, "breached", 1],
  ["평면 목록", 200, { breaches: ["예시서비스 A"] }, "breached", 1],
  ["공식 미발견 응답", 404, { Error: "Not found", email: null }, "not_found", 0],
  ["200 미발견 응답", 200, { Error: "Not found" }, "not_found", 0],
  ["미발견과 빈 목록", 404, { Error: "Not found", breaches: [] }, "not_found", 0],
  ["미발견과 유출 목록 충돌", 200, { Error: "Not found", breaches: [["예시서비스 A"]] }, "api_error", 0],
  ["빈 목록", 200, { breaches: [] }, "api_error", 0],
  ["빈 중첩 목록", 200, { breaches: [[]] }, "api_error", 0],
  ["빈 이름", 200, { breaches: [["", "  "]] }, "api_error", 0],
  ["잘못된 항목 혼합", 200, { breaches: [["예시서비스 A", null]] }, "api_error", 0],
  ["숫자 항목", 200, { breaches: [[123]] }, "api_error", 0],
  ["객체 항목", 200, { breaches: [{ name: "예시서비스 A" }] }, "api_error", 0],
  ["잘못된 중첩", 200, { breaches: [[["예시서비스 A"]]] }, "api_error", 0],
  ["목록 대신 문자열", 200, { breaches: "예시서비스 A" }, "api_error", 0],
  ["빈 객체", 200, {}, "api_error", 0],
  ["빈 본문", 200, null, "api_error", 0],
  ["HTML 본문", 200, "<html>오류 예시</html>", "api_error", 0],
  ["일반 404", 404, {}, "api_error", 0],
  ["리디렉션", 302, { breaches: [["예시서비스 A"]] }, "api_error", 0],
  ["요청 제한", 429, null, "rate_limited", 0],
  ["서비스 오류", 503, { Error: "Not found" }, "service_error", 0],
  ["접근 거부", 403, { Error: "Not found" }, "api_error", 0]
];
for (const [name, http, body, status, count] of cases) {
  test(name, () => {
    const result = parseEmailResponse(http, body);
    assert.equal(result.status, status);
    assert.equal(result.breach_count, count);
    assert.equal(result.cached, false);
    assert.ok(Number.isFinite(Date.parse(result.checked_at)));
    assert.equal("email" in result, false);
  });
}
