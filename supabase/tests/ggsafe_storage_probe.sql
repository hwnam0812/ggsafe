-- 합성 메타데이터만 사용하며 모두 되돌린다. 실제 사용자 기록을 읽거나 지우지 않는다.
BEGIN;
DO $probe$
DECLARE
    tablename TEXT;
    client_role TEXT;
    amount INTEGER;
BEGIN
    FOREACH tablename IN ARRAY ARRAY['ggsafe_history', 'ggsafe_cache', 'ggsafe_rate', 'ggsafe_leases'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = 'public' AND c.relname = tablename AND c.relrowsecurity
        ) THEN
            RAISE EXCEPTION 'GGSAFE row protection check failed';
        END IF;
        FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role)
               AND has_table_privilege(client_role, 'public.' || tablename, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
                RAISE EXCEPTION 'GGSAFE client access must be denied';
            END IF;
        END LOOP;
    END LOOP;
    IF EXISTS (SELECT 1 FROM public.ggsafe_history WHERE owner_key = 'synthetic-streamlit-rollback-probe') THEN
        RAISE EXCEPTION 'GGSAFE synthetic test collision';
    END IF;
    INSERT INTO public.ggsafe_history
        (owner_key, id, scan_type, status, breach_count, checked_at, created_at, cached)
    VALUES ('synthetic-streamlit-rollback-probe', 'rollback-probe-email', 'email', 'not_found', 0,
        '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z', 0);
    -- 같은 완료 구분값은 이력 한 건만 유지해야 한다.
    INSERT INTO public.ggsafe_history
        (owner_key, id, scan_type, status, breach_count, checked_at, created_at, cached)
    VALUES ('synthetic-streamlit-rollback-probe', 'rollback-probe-email', 'email', 'not_found', 0,
        '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z', 0)
    ON CONFLICT (owner_key, id) DO NOTHING;
    SELECT count(*) INTO amount FROM public.ggsafe_history
        WHERE owner_key = 'synthetic-streamlit-rollback-probe';
    IF amount <> 1 THEN
        RAISE EXCEPTION 'GGSAFE save/read or duplicate protection failed';
    END IF;
    SELECT count(*) INTO amount FROM public.ggsafe_history
        WHERE owner_key = 'synthetic-streamlit-other-probe';
    IF amount <> 0 THEN
        RAISE EXCEPTION 'GGSAFE owner filter check failed';
    END IF;
    INSERT INTO public.ggsafe_cache VALUES ('synthetic-streamlit-rollback-probe', '{"status":"not_found"}', 1);
    INSERT INTO public.ggsafe_rate VALUES ('synthetic-streamlit-rollback-probe', 1, 0);
    INSERT INTO public.ggsafe_rate VALUES ('synthetic-streamlit-rollback-probe', 1, 0)
        ON CONFLICT (rate_key) DO UPDATE SET count = public.ggsafe_rate.count + 1 RETURNING count INTO amount;
    IF amount <> 2 THEN
        RAISE EXCEPTION 'GGSAFE request counter check failed';
    END IF;
    INSERT INTO public.ggsafe_leases VALUES ('synthetic-streamlit-rollback-probe', 'synthetic-token', 1);
END
$probe$;
ROLLBACK;
