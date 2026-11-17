import test from "node:test";
import assert from "node:assert/strict";
import { startPreview, waitForApi } from "../scripts/preview-startup.mjs";

test("저장소와 API가 준비된 다음에만 화면을 시작한다", async () => {
  const calls = [];
  await startPreview({
    initialize: async () => { calls.push("initialize"); },
    startApi: () => { calls.push("api"); },
    waitUntilReady: async () => { calls.push("ready"); },
    startFrontend: () => { calls.push("frontend"); },
  });
  assert.deepEqual(calls, ["initialize", "api", "ready", "frontend"]);
});

for (const failingStep of ["initialize", "startApi", "waitUntilReady"]) {
  test(`${failingStep} 실패 시 준비되지 않은 화면을 열지 않는다`, async () => {
    let frontendStarted = false;
    const steps = {
      initialize: async () => {}, startApi: () => {}, waitUntilReady: async () => {},
      startFrontend: () => { frontendStarted = true; },
    };
    steps[failingStep] = () => { throw new Error("startup failed"); };
    await assert.rejects(startPreview(steps), /startup failed/);
    assert.equal(frontendStarted, false);
  });
}

test("중단한 시작 작업에서 다음 기능을 실행하지 않는다", async () => {
  const controller = new AbortController();
  let started = false;
  await assert.rejects(startPreview({
    initialize: () => controller.abort(),
    startApi: () => { started = true; },
    waitUntilReady: async () => {}, startFrontend: () => {}, signal: controller.signal,
  }), { name: "AbortError" });
  assert.equal(started, false);
});

test("연결 거절과 비정상 응답 뒤 실제 준비 완료까지 기다린다", async () => {
  let elapsed = 0;
  let calls = 0;
  const responses = [
    () => { throw new Error("ECONNREFUSED"); },
    () => new Response("not ready", { status: 500 }),
    () => new Response("<html>not ready</html>"),
    () => Response.json({ ok: false }),
    () => Response.json({ ok: true }),
  ];
  await waitForApi({
    fetchImpl: async url => {
      assert.equal(url, "http://127.0.0.1:8787/api/health");
      return responses[calls++]();
    },
    now: () => elapsed,
    pause: async ms => { elapsed += ms; },
  });
  assert.equal(calls, 5);
});

test("계속 준비되지 않으면 제한 시간 뒤 실패한다", async () => {
  let elapsed = 0;
  let calls = 0;
  await assert.rejects(waitForApi({
    fetchImpl: async () => { calls++; return Response.json({ ok: false }); },
    now: () => elapsed,
    pause: async ms => { elapsed += ms; },
    timeout: 500,
  }), /이력 조회 기능을 준비하지 못했어요/);
  assert.equal(calls, 3);
  assert.equal(elapsed, 500);
});

test("API 대기 중 중단 요청을 즉시 따른다", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(waitForApi({
    signal: controller.signal,
    fetchImpl: async () => { calls++; controller.abort(); throw new Error("cancelled"); },
    pause: async () => { assert.fail("중단 후 다시 기다리면 안 된다"); },
  }), { name: "AbortError" });
  assert.equal(calls, 1);
});
