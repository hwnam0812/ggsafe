import { ExternalLink, Monitor, Unplug } from "lucide-react";

export default function GoogleChecks() {
  return <section className="gg-google-checks"><div className="gg-section-heading"><h2>Google에서 직접 확인해요</h2><span>자동 검사 항목이 아니에요</span></div><div className="gg-manual-grid">{[
    { icon: Monitor, title: "로그인 기기 보기", detail: "Google에서 휴대폰·컴퓨터 목록을 직접 확인해요.", href: "https://www.google.com/devices" },
    { icon: Unplug, title: "연결된 앱 보기", detail: "Google에서 내 계정과 연결된 앱을 직접 확인해요.", href: "https://myaccount.google.com/linkedapps" }
  ].map(({ icon: Icon, title, detail, href }) => <a key={title} href={href} target="_blank" rel="noopener noreferrer" className="gg-manual-card"><span className="gg-manual-icon"><Icon size={22} aria-hidden="true"/></span><div><h3>{title}<span className="gg-manual-label">직접 확인</span></h3><p>{detail}</p></div><ExternalLink size={16} className="gg-manual-arrow" aria-hidden="true"/><span className="sr-only">새 창으로 열려요</span></a>)}</div></section>;
}
