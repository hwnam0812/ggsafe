import type { ScanResult, ScanStatus } from "../src/lib/security-types";

export function createEmailResult(status: ScanStatus, message: string, breaches: string[] = []): ScanResult {
  return { status, message, breaches, breach_count: breaches.length, source: "XposedOrNot", checked_at: new Date().toISOString(), cached: false };
}

export function parseEmailResponse(status: number, data: unknown): ScanResult {
  if (status === 429) return createEmailResult("rate_limited", "조회 서비스의 요청 한도에 도달했어요. 시간을 두고 다시 시도해 주세요.");
  if (status >= 500) return createEmailResult("service_error", "조회 서비스가 응답하지 않아요. 잠시 후 다시 시도해 주세요.");
  if (status !== 200 && status !== 404) return createEmailResult("api_error", "조회 서비스가 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
  if (!data || typeof data !== "object" || Array.isArray(data)) return createEmailResult("api_error", "검사 응답 형식이 올바르지 않아요. 다시 시도해 주세요.");
  const payload = data as Record<string, unknown>;
  if (payload.Error === "Not found" && (payload.breaches === undefined || (Array.isArray(payload.breaches) && payload.breaches.length === 0))) {
    return createEmailResult("not_found", "조회 가능한 공개 데이터에서 유출 기록을 찾지 못했어요.");
  }
  if (status !== 200 || payload.Error !== undefined || !Array.isArray(payload.breaches) || payload.breaches.length === 0) {
    return createEmailResult("api_error", "검사 응답이 비어 있거나 올바르지 않아요. 다시 시도해 주세요.");
  }
  const names: string[] = [];
  for (const group of payload.breaches) {
    const values = Array.isArray(group) ? group : [group];
    if (values.length === 0 || values.some(name => typeof name !== "string" || !name.trim())) {
      return createEmailResult("api_error", "유출 서비스 목록을 확인하지 못했어요. 다시 시도해 주세요.");
    }
    for (const name of values) names.push((name as string).trim());
  }
  return createEmailResult("breached", "이메일과 관련된 공개 유출 기록이 발견됐어요.", [...new Set(names)]);
}
