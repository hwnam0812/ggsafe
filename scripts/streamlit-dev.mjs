// 미리보기 복원 시에도 한 번의 시작으로 Streamlit 전체를 연다. 실제 게시에는 이 실행기를 쓰지 않는다.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { GOOGLE_CLIENT_ID } from "./google-preview.mjs";

const project = createHash("sha256").update(resolve(".")).digest("hex").slice(0, 16);
const cache = join(homedir(), ".cache", "ggsafe-streamlit", project);
mkdirSync(cache, { recursive: true, mode: 0o700 });
const environment = { ...process.env, UV_PROJECT_ENVIRONMENT: join(cache, "venv"), GGSAFE_LOCAL_PREVIEW: "1", GGSAFE_PREVIEW_DB: join(cache, "preview.sqlite3") };
// 시험 전용 실행기만 다른 저장 경로를 지정할 수 있다. 앱에는 우회 로그인 진입점이 없다.
if (process.env.GGSAFE_PREVIEW_DB) environment.GGSAFE_PREVIEW_DB = process.env.GGSAFE_PREVIEW_DB;
const settings = process.env.GGSAFE_SECRETS_FILE || join(cache, "secrets.toml");
if (!process.env.GGSAFE_SECRETS_FILE && process.env.GOOGLE_CLIENT_SECRET) {
  const cookieFile = join(cache, "cookie-key");
  if (!existsSync(cookieFile)) writeFileSync(cookieFile, randomBytes(48).toString("base64url"), { mode: 0o600 });
  const cookie = readFileSync(cookieFile, "utf8");
  // 웹 앱에서 PC 내부 주소를 기본값으로 쓰면 Google의 주소 불일치 오류가 난다.
  // 주소가 없으면 준비 상태로 남긴다. 이전 PC 앱의 Google 설정은 변경하지 않는다.
  const callback = process.env.GGSAFE_STREAMLIT_REDIRECT_URI || "";
  const q = JSON.stringify;
  writeFileSync(settings, `[auth]\nredirect_uri = ${q(callback)}\ncookie_secret = ${q(cookie)}\n[auth.google]\nclient_id = ${q(GOOGLE_CLIENT_ID)}\nclient_secret = ${q(process.env.GOOGLE_CLIENT_SECRET)}\nserver_metadata_url = "https://accounts.google.com/.well-known/openid-configuration"\nclient_kwargs = { scope = "openid email", prompt = "select_account" }\n`, { mode: 0o600 });
}
let child;
let stopped = false;
const stop = () => { stopped = true; child?.kill("SIGTERM"); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
function run(command, args) {
  return new Promise((resolve, reject) => {
    child = spawn(command, args, { stdio: "inherit", env: environment });
    child.once("error", () => reject(new Error("Streamlit 미리보기를 시작하지 못했어요.")));
    child.once("exit", code => code === 0 || stopped ? resolve() : reject(new Error("Streamlit 미리보기 준비가 끝나지 않았어요.")));
  });
}
try {
  await run("uv", ["sync", "--frozen", "--no-dev"]);
  if (!stopped) {
    const args = ["run", "--no-sync", "python", "-m", "streamlit", "run", "streamlit_app.py", "--server.address", "0.0.0.0", "--server.port", process.env.GGSAFE_STREAMLIT_PORT || "5173"];
    if (existsSync(settings)) args.push("--secrets.files", settings);
    await run("uv", args);
  }
} catch (error) { if (!stopped) { console.error(error.message); process.exitCode = 1; } }
