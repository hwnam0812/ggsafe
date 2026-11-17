"""명시적으로 실행하는 GGSAFE 실제 보관 연결 검사.

합성 메타데이터만 트랜잭션 안에서 검사하고 전부 되돌린다.
비밀번호·연결 주소·원문 오류·기존 사용자 기록은 출력하지 않는다.
앱에서는 import하거나 호출하지 않는다.
"""
from contextlib import contextmanager
import json
import os
import sys
import time
from urllib.parse import urlparse
import uuid

from ggsafe_streamlit.config import GGSAFE_POOLER, storage_settings
from ggsafe_streamlit.identity import iso
from ggsafe_streamlit.storage import Store


class TransactionStore(Store):
    def __init__(self, connection):
        super().__init__(database_url="postgresql://synthetic-probe")
        self.transaction_connection = connection

    @contextmanager
    def connection(self):
        yield self.transaction_connection


def main():
    if os.environ.get("GGSAFE_RUN_POSTGRES_PROBE") != "1":
        print(json.dumps({"skipped": True, "reason": "explicit_run_required"}))
        return 2
    stage = "settings"
    try:
        # 별도 시험 프로세스에서만 공개 연결 대상을 명시적으로 확인한다.
        os.environ.pop("GGSAFE_LOCAL_PREVIEW", None)
        settings = storage_settings({})
        parsed = urlparse(settings.get("database_url", ""))
        assert (parsed.hostname, parsed.port, parsed.username) == (
            GGSAFE_POOLER["host"], GGSAFE_POOLER["port"], GGSAFE_POOLER["user"]
        )
        stage = "connect_and_prepare"
        store = Store(**settings).prepare()
        owner = "synthetic-streamlit-postgres-" + str(uuid.uuid4())
        other = owner + "-other"
        email_hash = owner + "-cache"
        now = time.time()
        entry = dict(id=str(uuid.uuid4()), scan_type="email", status="not_found",
            breach_count=0, checked_at=iso(now), cached=False)

        with store.connection() as connection:
            stage = "encrypted_connection"
            # 공유 연결은 TLS를 중계하므로 서버 내부 구간의 pg_stat_ssl로 판정하지 않는다.
            assert connection.pgconn.ssl_in_use
            with connection.transaction(force_rollback=True):
                probe = TransactionStore(connection)
                stage = "history_save_read"
                probe.save(owner, entry, now=now)
                rows = probe.history(owner, now)
                assert len(rows) == 1 and rows[0]["id"] == entry["id"]

                stage = "duplicate_protection"
                probe.save(owner, {**entry, "status": "breached", "breach_count": 42}, now=now)
                rows = probe.history(owner, now)
                assert len(rows) == 1 and rows[0]["status"] == "not_found" and rows[0]["breach_count"] == 0

                stage = "account_isolation"
                assert probe.history(other, now) == []
                stage = "password_metadata"
                probe.save(owner, {**entry, "id": str(uuid.uuid4()), "scan_type": "password",
                    "status": "breached", "breach_count": 12345}, now=now)
                rows = probe.history(owner, now)
                assert len(rows) == 2 and {row["scan_type"] for row in rows} == {"email", "password"}
                assert all(set(row) == {"id", "scan_type", "status", "breach_count", "checked_at", "created_at", "cached"} for row in rows)

                stage = "cache"
                assert probe.cached(email_hash, now) is None
                probe.cache(email_hash, {"status": "not_found", "source": "synthetic"}, now)
                assert probe.cached(email_hash, now)["status"] == "not_found"
                assert probe.cached(email_hash, now + 301) is None

                stage = "rate_limit"
                assert probe.rate(owner, now) == 1 and probe.rate(owner, now) == 2
                stage = "concurrency_lock"
                assert probe.acquire(email_hash, "synthetic-first", now)
                assert not probe.acquire(email_hash, "synthetic-second", now)
                assert probe.acquire(email_hash, "synthetic-next", now + 26)

        stage = "rollback_and_reconnect"
        # 별도 연결로 다시 읽어 합성 기록이 한 건도 남지 않았음을 확인한다.
        assert store.history(owner, now) == []
        remaining = store.query(
            "SELECT (SELECT count(*) FROM ggsafe_cache WHERE email_hash = ?) + "
            "(SELECT count(*) FROM ggsafe_rate WHERE rate_key = ?) + "
            "(SELECT count(*) FROM ggsafe_leases WHERE email_hash = ?) AS n",
            (email_hash, f"{owner}:{int(now // 60)}", email_hash),
        )
        assert remaining[0]["n"] == 0
        print(json.dumps({"connection": True, "encrypted": True, "history_save_read": True,
            "duplicate_protection": True, "account_isolation": True, "password_metadata": True,
            "cache": True, "rate_limit": True, "concurrency_lock": True,
            "reconnected_after_rollback": True, "test_rows_remaining": 0}))
        return 0
    except Exception as error:
        # 외부 연결 오류 원문에는 설정값이 포함될 수 있으므로 유형과 단계만 출력한다.
        print(json.dumps({"connection": False, "stage": stage,
            "error_type": type(error).__name__, "sqlstate": getattr(error, "sqlstate", None)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
