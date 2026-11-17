// 미리보기에서 로그인 처리와 검사 처리가 동시에 저장소를 사용할 때의 짧은 잠금만 재시도한다.
// 외부 조회·횟수 증가처럼 반복하면 의미가 달라지는 작업에는 사용하지 않는다.
const delays = [25, 60, 120, 220];

export function temporarySecurityStorageError(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let current: unknown = error; current && typeof current === "object" && !seen.has(current);) {
    seen.add(current);
    if ("message" in current && typeof current.message === "string" && /SQLITE_BUSY|database is locked|Failed to get session commit token/i.test(current.message)) return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

export async function withSecurityStorageRetry<T>(operation: () => Promise<T>, pause: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= delays.length || !temporarySecurityStorageError(error)) throw error;
      await pause(delays[attempt]);
    }
  }
}
