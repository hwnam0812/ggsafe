import { ArrowUpRight, KeyRound, Monitor, ShieldCheck, Unplug } from "lucide-react";
import { Link } from "react-router";
import { useSecurity } from "../security/SecurityProvider";

export default function SecurityGuide() {
  const { state: { result } } = useSecurity();
  return <div className="gg-easy-guide">
    <div className="gg-page-heading"><div><p>어디서 무엇을 할지, 쉽게 알려드려요</p><h1>해결 가이드</h1></div></div>
    <div className="gg-guide-intro"><ShieldCheck size={30} aria-hidden="true"/><div><h2>{result?.status === "breached" ? "유출 기록이 있다면, 비밀번호부터 바꿔요." : "내 기기와 비밀번호부터 확인해요."}</h2><p>GGSAFE가 대신 바꾸지는 않아요. 아래 안내를 보고 직접 확인해 주세요.</p></div></div>
    <section className="gg-guide-device" aria-labelledby="guide-device-title">
      <div className="gg-guide-task-title"><Monitor size={27} aria-hidden="true"/><h2 id="guide-device-title">내 Google 계정에 로그인한 기기 보기</h2></div>
      <p>내 계정을 사용한 휴대폰과 컴퓨터를 Google에서 확인할 수 있어요.</p>
      <a href="https://www.google.com/devices" target="_blank" rel="noopener noreferrer" className="gg-primary-button">Google에서 로그인 기기 보기<ArrowUpRight size={18} aria-hidden="true"/><span className="sr-only"> (새 창)</span></a>
      <div className="gg-guide-device-next"><strong>링크를 연 다음에는요</strong><ol><li>확인할 Google 계정이 맞는지 봐 주세요.</li><li>기기 이름을 눌러 자세한 내용을 확인해요.</li><li>모르는 기기라면 Google 화면에서 로그아웃해요.</li></ol></div>
      <p className="gg-guide-small">최근 사용한 기기도 함께 보일 수 있어요. GGSAFE는 기기 목록을 가져오거나 저장하지 않아요.</p>
      <a className="gg-guide-help-link" href="https://support.google.com/accounts/answer/3067630?hl=ko" target="_blank" rel="noopener noreferrer">Google 공식 도움말<ArrowUpRight size={14} aria-hidden="true"/><span className="sr-only"> (새 창)</span></a>
    </section>
    <div className="gg-guide-tasks">
      <section id="password" className="gg-guide-task" aria-labelledby="guide-password-title"><div className="gg-guide-task-title"><KeyRound size={24} aria-hidden="true"/><h2 id="guide-password-title">유출된 비밀번호 바꾸기</h2></div><p>검사에서 비밀번호 유출이 나왔다면 이렇게 해요.</p><ol><li>그 비밀번호를 쓰는 사이트나 앱을 직접 열어요.</li><li>설정에서 ‘비밀번호 변경’을 찾아요.</li><li>다른 곳에서 쓰지 않는 새 비밀번호로 바꿔요.</li></ol><p className="gg-guide-small">다른 곳에도 같은 비밀번호를 썼다면 각각 바꿔 주세요. 유출 기록이 없어도 안전을 보장하지는 않아요.</p><Link to="/scan?tab=password" className="gg-secondary-button">비밀번호 유출 검사하기<ArrowUpRight size={16} aria-hidden="true"/></Link></section>
      <section className="gg-guide-task" aria-labelledby="guide-apps-title"><div className="gg-guide-task-title"><Unplug size={24} aria-hidden="true"/><h2 id="guide-apps-title">안 쓰는 앱 연결 확인하기</h2></div><p>내 Google 계정과 연결된 앱을 살펴봐요. 필요 없는 연결은 Google 화면에서 직접 정리할 수 있어요.</p><a href="https://myaccount.google.com/linkedapps" target="_blank" rel="noopener noreferrer" className="gg-secondary-button">Google 연결 앱 보기<ArrowUpRight size={16} aria-hidden="true"/><span className="sr-only"> (새 창)</span></a><a className="gg-guide-help-link" href="https://support.google.com/accounts/answer/13533235?hl=ko" target="_blank" rel="noopener noreferrer">Google 공식 도움말<ArrowUpRight size={14} aria-hidden="true"/><span className="sr-only"> (새 창)</span></a></section>
    </div>
  </div>;
}
