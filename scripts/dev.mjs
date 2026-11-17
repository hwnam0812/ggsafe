// 저장소 준비 → API 준비 확인 → 화면 순서로 시작해 첫 이력 조회의 연결 오류를 막는다.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { startPreview, waitForApi } from "./preview-startup.mjs";

mkdirSync("dist", { recursive: true });
const procs = new Set();
const controller = new AbortController();
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  controller.abort();
  for (const p of procs) p.kill("SIGTERM");
}

function run(args) {
  const p = spawn(process.execPath, args, { stdio: "inherit" });
  procs.add(p);
  p.once("exit", () => procs.delete(p));
  return p;
}

function service(args) {
  const p = run(args);
  p.once("error", () => {
    console.error("미리보기 실행에 실패했어요.");
    stop(1);
  });
  p.once("exit", code => {
    if (stopping) return;
    console.error("미리보기의 필수 기능이 종료됐어요.");
    stop(code || 1);
  });
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

try {
  await startPreview({
    initialize: () => new Promise((resolve, reject) => {
      const p = run(["scripts/db-init.mjs"]);
      p.once("error", () => reject(new Error("미리보기 저장소를 준비하지 못했어요.")));
      p.once("exit", code => code === 0 ? resolve() : reject(new Error("미리보기 저장소를 준비하지 못했어요.")));
    }),
    startApi: () => service(["node_modules/wrangler/bin/wrangler.js", "dev", "--ip", "0.0.0.0", "--port", "8787"]),
    waitUntilReady: () => waitForApi({ signal: controller.signal }),
    startFrontend: () => service(["node_modules/vite/bin/vite.js", "--strictPort"]),
    signal: controller.signal,
  });
} catch (error) {
  if (!stopping) { console.error(error.message); stop(1); }
}
