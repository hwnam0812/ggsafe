type CredentialResponse = { credential: string; state?: string };
export type GoogleIdentity = {
  initialize: (options: { client_id: string; nonce: string; callback: (response: CredentialResponse) => void; ux_mode: "popup"; auto_select: false; use_fedcm_for_button: false }) => void;
  renderButton: (element: HTMLElement, options: { type: "standard"; theme: "outline"; size: "large"; text: "continue_with"; locale: "ko"; width: number; state: string; click_listener: () => void }) => void;
  disableAutoSelect: () => void;
};
declare global { interface Window { google?: { accounts?: { id?: GoogleIdentity } } } }

let loading: Promise<GoogleIdentity> | null = null;

// Google 공식 라이브러리만 계정 연결 창을 열었을 때 불러온다. 토큰은 저장하지 않는다.
export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  const existing = window.google?.accounts?.id;
  if (existing) return Promise.resolve(existing);
  if (loading) return loading;
  loading = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      window.clearTimeout(timer); script.remove(); loading = null;
      reject(new Error("Google 로그인 버튼을 불러오지 못했어요. 연결 상태나 브라우저의 차단 설정을 확인한 뒤 다시 준비해 주세요."));
    };
    const timer = window.setTimeout(fail, 15000);
    script.src = "https://accounts.google.com/gsi/client?hl=ko";
    script.async = true;
    script.referrerPolicy = "strict-origin-when-cross-origin";
    script.onerror = fail;
    script.onload = () => {
      const identity = window.google?.accounts?.id;
      if (!identity) { fail(); return; }
      window.clearTimeout(timer); resolve(identity);
    };
    document.head.append(script);
  });
  return loading;
}
