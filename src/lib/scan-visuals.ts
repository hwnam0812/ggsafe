import type { PasswordCheckPhase, PasswordResult } from "./password-check";
import type { ScanResult } from "./security-types";

// 표시용 상태다. 검사 요청·동의·저장 여부를 결정하거나 시간으로 단계를 넘기지 않는다.
export type EmailScanPhase = "identity" | "lookup" | "history";
export type PasswordScanPhase = "identity" | PasswordCheckPhase;
export type ScanJourneyState =
  | { status: "ready" }
  | { status: "running"; step: number; detail: string }
  | { status: "complete" }
  | { status: "incomplete"; step: number; detail: string };
export type ScanSummary =
  | { outcome: "found" | "not_found"; count: number }
  | { outcome: "incomplete" };

export function emailSummary(result: ScanResult): ScanSummary {
  if (result.status === "breached") return { outcome: "found", count: result.breach_count };
  if (result.status === "not_found") return { outcome: "not_found", count: 0 };
  return { outcome: "incomplete" };
}

export function emailJourney(phase: EmailScanPhase, busy: boolean, result: ScanResult | null): ScanJourneyState {
  const step = phase === "identity" ? 0 : phase === "lookup" ? 1 : 2;
  if (busy) return { status: "running", step, detail: {
    identity: "검사 전에 로그인 상태를 확인하고 있어요.",
    lookup: "유출 기록 조회 응답을 기다리고 있어요. 최근 결과를 재사용할 수도 있어요.",
    history: "조회 응답을 받았어요. 결과와 검사 이력을 확인하고 있어요.",
  }[phase] };
  if (!result) return { status: "ready" };
  if (emailSummary(result).outcome !== "incomplete") return { status: "complete" };
  return { status: "incomplete", step, detail: "유출 여부를 확정하지 못했어요. 아래 안내를 확인해 주세요." };
}

export function passwordJourney(phase: PasswordScanPhase | null, busy: boolean, result: PasswordResult | null, error: string): ScanJourneyState {
  const step = phase === "lookup" ? 1 : phase === "comparing" ? 2 : 0;
  if (busy) return { status: "running", step, detail: {
    identity: "검사 전에 로그인 상태를 확인하고 있어요.",
    hashing: "비밀번호를 이 기기 안에서 변환하고 있어요.",
    lookup: "변환값 앞 5글자로 유출 자료를 요청하고 있어요.",
    comparing: "받은 자료와 이 기기 안에서 비교하고 있어요.",
  }[phase ?? "identity"] };
  if (result) return { status: "complete" };
  if (phase && error) return { status: "incomplete", step, detail: "검사가 끝나지 않았어요. 미발견 결과가 아니에요." };
  return { status: "ready" };
}
