-- 배포 때 BAZE 가 이 파일을 D1 에 적용한다. 바꿀 때는 기존 표를 지우지 말고 더하기만 한다.
CREATE TABLE IF NOT EXISTS rate_limit (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- 소유자가 /admin 에서 바꾸는 값(src/content.ts 의 settings). value 는 JSON. 없으면 content.ts 의 기본값.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT
);

-- _base 의 /admin 견본이 쓰는 문의 표. 새 템플릿은 자기 표로 바꾸거나 지운다(아직 배포 전일 때만).
CREATE TABLE IF NOT EXISTS inquiry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  assignee TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- GGSAFE: 이메일 원문과 비밀번호를 보관하지 않는 검사 결과 메타데이터.
CREATE TABLE IF NOT EXISTS security_history (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  status TEXT NOT NULL,
  breach_count INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cached INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_security_history_owner ON security_history(owner_key, created_at DESC);
-- 완료한 비밀번호 검사 메타데이터만 보관한다. 원문·해시·해시 일부는 받지 않는다.
-- 기존 이메일 기록은 변경하지 않고 조회 화면에서 두 종류를 함께 표시한다.
CREATE TABLE IF NOT EXISTS security_password_history (
  id TEXT NOT NULL,
  owner_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('breached', 'not_found')),
  breach_count INTEGER NOT NULL CHECK (breach_count >= 0),
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_key, id),
  CHECK ((status = 'breached' AND breach_count > 0) OR (status = 'not_found' AND breach_count = 0))
);
CREATE INDEX IF NOT EXISTS idx_security_password_history_owner ON security_password_history(owner_key, created_at DESC);
CREATE TABLE IF NOT EXISTS security_cache (
  email_hash TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS security_inflight (
  email_hash TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 미리보기 Google 로그인의 앱 전용 연결이다. Google 토큰·원본 sub는 저장하지 않는다.
-- 이메일과 화면 복구 정보는 서버 전용 키로 암호화하며 검사 처리기는 해시만 읽는다.
-- 기존 브라우저 기록과 구분되는 google:v1: 소유자만 새 계정 기록에 사용한다.
CREATE TABLE IF NOT EXISTS security_account_sessions (
  token_hash TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  csrf_hash TEXT NOT NULL,
  private_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_account_sessions_expiry ON security_account_sessions(expires_at);
