-- 기존 기록을 지우거나 옮기지 않는 GGSAFE 전용 보관 준비.
-- 실제 비밀번호·쿠키·사용자 기록은 이 파일에 넣지 않는다.
CREATE TABLE IF NOT EXISTS public.ggsafe_history (
    owner_key TEXT NOT NULL,
    id TEXT NOT NULL,
    scan_type TEXT NOT NULL,
    status TEXT NOT NULL,
    breach_count BIGINT NOT NULL,
    checked_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    cached INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (owner_key, id)
);
CREATE INDEX IF NOT EXISTS ggsafe_history_owner_date
    ON public.ggsafe_history (owner_key, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS public.ggsafe_cache (
    email_hash TEXT PRIMARY KEY,
    result_json TEXT NOT NULL,
    expires_at DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS public.ggsafe_rate (
    rate_key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    window_start DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS public.ggsafe_leases (
    email_hash TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    expires_at DOUBLE PRECISION NOT NULL
);

-- 클라이언트에는 이 표에 대한 허용 정책을 만들지 않는다.
-- Google 신원 확인·계정별 조회 조건은 기존 Streamlit 처리기가 적용한다.
ALTER TABLE public.ggsafe_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ggsafe_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ggsafe_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ggsafe_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ggsafe_history, public.ggsafe_cache,
    public.ggsafe_rate, public.ggsafe_leases FROM PUBLIC;

-- Supabase가 아닌 PostgreSQL에도 같은 파일을 적용할 수 있다.
DO $ggsafe$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON public.ggsafe_history, public.ggsafe_cache,
            public.ggsafe_rate, public.ggsafe_leases FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON public.ggsafe_history, public.ggsafe_cache,
            public.ggsafe_rate, public.ggsafe_leases FROM authenticated;
    END IF;
END
$ggsafe$;
