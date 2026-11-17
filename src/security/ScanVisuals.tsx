import { AlertCircle, Check, CircleDashed, LoaderCircle, SearchCheck, ShieldAlert } from "lucide-react";
import type { ScanJourneyState, ScanSummary } from "../lib/scan-visuals";
import "./scan-visuals.css";

const journeys = {
  email: ["계정 확인", "유출 기록 조회", "결과 확인"],
  password: ["검사 준비·보호 변환", "유출 자료 조회", "기기 안에서 비교"],
};

export function ScanJourney({ kind, state }: { kind: "email" | "password"; state: ScanJourneyState }) {
  const label = state.status === "ready" ? "검사 전" : state.status === "running" ? "진행 중" : state.status === "complete" ? "검사 완료" : "검사 미완료";
  return <section className="gg-scan-journey" data-state={state.status} aria-label="검사 진행 상황">
    <div className="gg-journey-heading"><h3>검사 진행 상황</h3><span>{label}</span></div>
    <ol className="gg-journey-steps">
      {journeys[kind].map((title, index) => {
        const status = state.status === "complete" || (state.status !== "ready" && index < state.step) ? "done"
          : state.status !== "ready" && index === state.step ? state.status === "running" ? "active" : "stopped" : "waiting";
        const Icon = status === "done" ? Check : status === "active" ? LoaderCircle : status === "stopped" ? AlertCircle : CircleDashed;
        const stepLabel = status === "done" ? "완료" : status === "active" ? "진행 중" : status === "stopped" ? "미완료" : "대기";
        return <li key={title} data-step-state={status} aria-current={status === "active" ? "step" : undefined}>
          <span className="gg-journey-node" aria-hidden="true"><span className={status === "active" ? "gg-journey-spinner gg-spinning" : "gg-journey-spinner"}><Icon size={16}/></span></span>
          <span className="gg-journey-step-title">{title}</span><span className="gg-journey-step-status">{stepLabel}</span>
        </li>;
      })}
    </ol>
    <p className="gg-journey-detail" role="status" aria-live="polite" aria-atomic="true">
      {state.status === "ready" ? "동의 후 검사 버튼을 누르면 실제 처리 단계를 보여드려요."
        : state.status === "complete" ? "조회와 결과 확인을 마쳤어요. 아래에서 결과와 이력 저장 상태를 확인해 주세요." : state.detail}
    </p>
  </section>;
}

export function ScanResultVisual({ kind, summary, title }: { kind: "email" | "password"; summary: ScanSummary; title: string }) {
  const Icon = summary.outcome === "found" ? ShieldAlert : summary.outcome === "not_found" ? SearchCheck : AlertCircle;
  return <div className="gg-scan-result-visual" data-outcome={summary.outcome} role={summary.outcome === "incomplete" ? undefined : "status"} aria-atomic="true">
    <div className="gg-visual-result-heading">
      <span className="gg-result-symbol" aria-hidden="true"><Icon size={26} strokeWidth={1.7}/></span>
      <div><span className="gg-result-outcome-label">{summary.outcome === "found" ? "유출 기록 발견" : summary.outcome === "not_found" ? "조회 범위에서 미발견" : "유출 여부 확인 불가"}</span><h3>{title}</h3></div>
    </div>
    {summary.outcome !== "incomplete" ? <>
      <div className="gg-found-count gg-visual-count"><strong>{summary.count.toLocaleString("ko-KR")}</strong><span>{kind === "email" ? "개" : "회"}</span></div>
      <p className="gg-visual-count-label">{kind === "email" ? "관련 유출 서비스" : "유출 자료에 등장한 횟수"}</p>
      <p className="gg-visual-meaning">{summary.outcome === "not_found" ? "알려진 자료에서 찾지 못했다는 뜻이며, 안전을 보장하지 않아요."
        : kind === "email" ? "아래에서 조회된 서비스와 필요한 조치를 확인해 주세요." : "계정이나 서비스 개수가 아니며, 내 계정의 해킹 여부를 뜻하지 않아요."}</p>
    </> : <p className="gg-visual-meaning">조회가 완료되지 않아 발견 개수를 표시하지 않아요. 아래 안내에 따라 다시 시도해 주세요.</p>}
  </div>;
}
