import { setTimeout as delay } from "node:timers/promises";

export async function startPreview({ initialize, startApi, waitUntilReady, startFrontend, signal }) {
  for (const step of [initialize, startApi, waitUntilReady, startFrontend]) {
    signal?.throwIfAborted();
    await step();
  }
}

export async function waitForApi({ signal, fetchImpl = fetch, pause = delay, now = Date.now, timeout = 30_000 } = {}) {
  const deadline = now() + timeout;
  while (now() < deadline) {
    signal?.throwIfAborted();
    try {
      const response = await fetchImpl("http://127.0.0.1:8787/api/health", {
        signal: AbortSignal.any([AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - now()))), ...(signal ? [signal] : [])]),
      });
      if (response.ok && (await response.json()).ok === true) return;
    } catch { /* API가 준비되는 동안의 연결 거절·재시작은 제한된 시간만 기다린다. */ }
    signal?.throwIfAborted();
    if (now() < deadline) await pause(Math.min(200, deadline - now()), undefined, { signal });
  }
  throw new Error("미리보기의 이력 조회 기능을 준비하지 못했어요. 실행 로그를 확인해 주세요.");
}
