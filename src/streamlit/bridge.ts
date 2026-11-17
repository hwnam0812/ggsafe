// Streamlit v1의 공식 메시지 규약만 사용한다. 신원은 Python의 st.user가 결정한다.
export type NativeSession = {
  available: boolean; user: { email: string } | null; connection_id: string;
  expires_at: string | null; storage_ready: boolean; storage_error?: string; local_preview: boolean; error: string;
};
type Snapshot = { session: NativeSession; ready: boolean };
type Reply = { id: string; ok: boolean; value?: unknown; status?: number; error?: string };
type Job = { id: string; connection: string; action: string; data: unknown; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number; signal?: AbortSignal; cleanup: () => void };
export class BridgeError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
let snapshot: Snapshot = { ready: false, session: { available: false, user: null, connection_id: "", expires_at: null, storage_ready: false, local_preview: false, error: "" } };
let encoded = "";
const listeners = new Set<() => void>();
const queue: Job[] = [];
let active: Job | undefined;

const post = (type: string, data: object) => window.parent.postMessage({ isStreamlitMessage: true, type, ...data }, "*");
export const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getSnapshot = () => snapshot;
export function invalidate(message = "로그인 상태가 바뀌었어요. Google로 다시 로그인해 주세요.") {
  snapshot = { ready: true, session: { ...snapshot.session, user: null, error: message } };
  encoded = "";
  for (const listener of listeners) listener();
}
function pump() {
  if (active || !queue.length || !snapshot.ready) return;
  active = queue.shift();
  if (!active) return;
  if (active.signal?.aborted) { finish(active.id, undefined, new BridgeError("요청을 중단했어요.", 0)); return; }
  post("streamlit:setComponentValue", { dataType: "json", value: { id: active.id, connection: active.connection, action: active.action, data: active.data } });
}
function finish(id: string, value?: unknown, error?: Error) {
  const job = active?.id === id ? active : queue.find(item => item.id === id);
  if (!job) return;
  window.clearTimeout(job.timer); job.cleanup();
  if (active === job) active = undefined;
  else queue.splice(queue.indexOf(job), 1);
  if (error) job.reject(error); else job.resolve(value);
  queueMicrotask(pump);
}
export function nativeRequest<T>(action: string, data: unknown = {}, options: { connection?: string; signal?: AbortSignal } = {}): Promise<T> {
  if (options.signal?.aborted) return Promise.reject(new BridgeError("요청을 중단했어요.", 0));
  return new Promise<T>((resolve, reject) => {
    const id = crypto.randomUUID();
    const abort = () => finish(id, undefined, new BridgeError("요청을 중단했어요.", 0));
    const job: Job = { id, action, data, connection: options.connection ?? snapshot.session.connection_id,
      resolve: value => resolve(value as T), reject, signal: options.signal,
      timer: window.setTimeout(() => finish(id, undefined, new BridgeError("응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.", 503)), 25000),
      cleanup: () => options.signal?.removeEventListener("abort", abort) };
    options.signal?.addEventListener("abort", abort, { once: true });
    queue.push(job); pump();
  });
}

window.addEventListener("message", event => {
  if (event.source !== window.parent || event.data?.type !== "streamlit:render") return;
  const session = event.data.args?.session as NativeSession | undefined;
  if (!session || typeof session.connection_id !== "string") return;
  const text = JSON.stringify(session);
  if (encoded !== text) {
    const previous = snapshot.session.connection_id;
    snapshot = { ready: true, session }; encoded = text;
    if (previous && previous !== session.connection_id) {
      for (const job of [...queue, ...(active ? [active] : [])]) finish(job.id, undefined, new BridgeError("계정이 바뀌었어요. 현재 계정에서 다시 시도해 주세요.", 401));
    }
    for (const listener of listeners) listener();
  }
  const reply = event.data.args?.reply as Reply | undefined;
  if (reply?.id && active?.id === reply.id) {
    if (!reply.ok && reply.status === 401) invalidate(reply.error);
    finish(reply.id, reply.value, reply.ok ? undefined : new BridgeError(reply.error || "요청을 완료하지 못했어요.", reply.status ?? 503));
  }
  pump();
});
post("streamlit:componentReady", { apiVersion: 1 });
// Streamlit은 iframe의 안쪽 스크롤을 끈다. 전체 내용 높이를 알려 바깥 문서가 스크롤하게 한다.
// viewport/scrollHeight를 측정하면 iframe 높이가 다시 측정에 포함되어 줄어들지 않는다.
const root = document.getElementById("root")!;
let frameHeight = 0, scheduled = false;
function resizeFrame() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const height = Math.max(1, Math.ceil(root.getBoundingClientRect().height));
    if (height !== frameHeight) {
      frameHeight = height;
      post("streamlit:setFrameHeight", { height });
    }
  });
}
new ResizeObserver(resizeFrame).observe(root);
window.addEventListener("resize", resizeFrame);
document.fonts.ready.then(resizeFrame);
resizeFrame();
