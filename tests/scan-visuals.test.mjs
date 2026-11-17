import test from "node:test";
import assert from "node:assert/strict";
import { emailJourney, emailSummary, passwordJourney } from "../src/lib/scan-visuals.ts";

const emailResult = status => ({ status, breach_count: status === "breached" ? 12 : 0, breaches: [], message: "합성 테스트", cached: false, checked_at: "2026-11-17T00:00:00Z", source: "합성 테스트" });

test("검사 전에는 단계가 자동으로 진행되지 않아요", () => {
  assert.deepEqual(emailJourney("identity", false, null), { status: "ready" });
  assert.deepEqual(passwordJourney(null, false, null, ""), { status: "ready" });
  assert.deepEqual(passwordJourney(null, false, null, "동의가 필요해요"), { status: "ready" });
});

test("이메일은 실제 계정 확인·조회 응답·이력 확인 단계만 표시해요", () => {
  for (const [phase, step] of [["identity", 0], ["lookup", 1], ["history", 2]]) {
    const state = emailJourney(phase, true, null);
    assert.equal(state.status, "running"); assert.equal(state.step, step);
  }
  for (const status of ["breached", "not_found"]) {
    assert.deepEqual(emailJourney("history", false, emailResult(status)), { status: "complete" });
  }
});

test("이메일 조회 오류·제한·진행 중은 0개나 완료로 표시하지 않아요", () => {
  for (const status of ["invalid_input", "api_error", "service_error", "rate_limited", "timeout", "network_error", "in_progress"]) {
    const result = emailResult(status);
    assert.deepEqual(emailSummary(result), { outcome: "incomplete" });
    assert.equal(emailJourney("lookup", false, result).status, "incomplete");
    assert.equal(emailJourney("lookup", false, result).step, 1);
  }
  assert.equal(emailJourney("identity", false, emailResult("network_error")).step, 0);
});

test("발견 개수와 미발견은 조회 결과 그대로 표시해요", () => {
  assert.deepEqual(emailSummary(emailResult("breached")), { outcome: "found", count: 12 });
  assert.deepEqual(emailSummary(emailResult("not_found")), { outcome: "not_found", count: 0 });
});

test("비밀번호는 신원 확인·변환·요청·기기 내 비교의 실제 단계를 표시해요", () => {
  for (const [phase, step] of [["identity", 0], ["hashing", 0], ["lookup", 1], ["comparing", 2]]) {
    assert.equal(passwordJourney(phase, true, null, "").step, step);
    const stopped = passwordJourney(phase, false, null, "검사를 중단했어요");
    assert.equal(stopped.status, "incomplete"); assert.equal(stopped.step, step);
  }
  for (const status of ["found", "not_found"]) assert.deepEqual(passwordJourney("comparing", false, { status, count: 0, checked_at: "합성" }, ""), { status: "complete" });
});
