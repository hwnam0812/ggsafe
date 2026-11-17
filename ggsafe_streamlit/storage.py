"""계정별 메타데이터 저장. 게시용 PostgreSQL / 명시적인 로컬 미리보기용 SQLite."""
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import time

from .identity import iso, PublicError

SCHEMA = (
    "CREATE TABLE IF NOT EXISTS ggsafe_history (owner_key TEXT NOT NULL, id TEXT NOT NULL, scan_type TEXT NOT NULL, status TEXT NOT NULL, breach_count BIGINT NOT NULL, checked_at TEXT NOT NULL, created_at TEXT NOT NULL, cached INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(owner_key, id))",
    "CREATE INDEX IF NOT EXISTS ggsafe_history_owner_date ON ggsafe_history(owner_key, created_at DESC, id DESC)",
    "CREATE TABLE IF NOT EXISTS ggsafe_cache (email_hash TEXT PRIMARY KEY, result_json TEXT NOT NULL, expires_at DOUBLE PRECISION NOT NULL)",
    "CREATE TABLE IF NOT EXISTS ggsafe_rate (rate_key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start DOUBLE PRECISION NOT NULL)",
    "CREATE TABLE IF NOT EXISTS ggsafe_leases (email_hash TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at DOUBLE PRECISION NOT NULL)",
)

def storage_retry(operation, pause=time.sleep):
    delays = (0.025, 0.060, 0.120, 0.220)
    for attempt in range(5):
        try:
            return operation()
        except Exception as error:
            # 알 수 없는 오류와 외부 조회·요청 횟수 증가는 재시도하지 않는다.
            busy = isinstance(error, sqlite3.OperationalError) and any(word in str(error).lower() for word in ("locked", "busy"))
            if not busy or attempt == 4:
                raise
            pause(delays[attempt])

class Store:
    def __init__(self, *, database_url: str = "", preview_path: str = ""):
        if not database_url and not preview_path:
            raise PublicError("검사 이력 보관 연결을 준비 중이에요. 운영자에게 알려 주세요.", 503)
        if database_url and not database_url.startswith(("postgresql://", "postgres://")):
            raise PublicError("검사 이력 보관 설정을 확인해 주세요.", 503)
        self._url, self._path = database_url, preview_path
        if not database_url:
            Path(preview_path).parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def connection(self):
        if self._url:
            import psycopg
            from psycopg.rows import dict_row
            connection = psycopg.connect(self._url, connect_timeout=8, sslmode="require", row_factory=dict_row)
        else:
            connection = sqlite3.connect(self._path, timeout=5)
            connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def execute(self, connection, sql, values=()):
        return connection.execute(sql.replace("?", "%s") if self._url else sql, values)

    def prepare(self):
        def operation():
            with self.connection() as connection:
                if self._url:
                    # 두 방문자가 처음 열어도 표 준비가 서로 충돌하지 않는다.
                    connection.execute("SELECT pg_advisory_xact_lock(1734821631)")
                for statement in SCHEMA:
                    self.execute(connection, statement)
        storage_retry(operation)
        return self

    def query(self, sql, values=(), *, retry=True):
        def operation():
            with self.connection() as connection:
                cursor = self.execute(connection, sql, values)
                return [dict(row) for row in cursor.fetchall()] if cursor.description else []
        return storage_retry(operation) if retry else operation()

    def history(self, owner, now):
        return self.query("SELECT id, scan_type, status, breach_count, checked_at, created_at, cached FROM ggsafe_history WHERE owner_key = ? AND created_at >= ? ORDER BY created_at DESC, id DESC LIMIT 100", (owner, iso(now - 30 * 86400)))

    def save(self, owner, entry, *, now):
        self.query("INSERT INTO ggsafe_history (owner_key,id,scan_type,status,breach_count,checked_at,created_at,cached) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner_key,id) DO NOTHING", (owner, entry["id"], entry["scan_type"], entry["status"], entry["breach_count"], entry["checked_at"], iso(now), int(entry.get("cached", False))))

    def clear(self, owner):
        self.query("DELETE FROM ggsafe_history WHERE owner_key = ?", (owner,))

    def cached(self, email_hash, now):
        rows = self.query("SELECT result_json FROM ggsafe_cache WHERE email_hash = ? AND expires_at > ?", (email_hash, now))
        return json.loads(rows[0]["result_json"]) if rows else None

    def cache(self, email_hash, result, now):
        self.query("INSERT INTO ggsafe_cache (email_hash,result_json,expires_at) VALUES (?,?,?) ON CONFLICT(email_hash) DO UPDATE SET result_json=excluded.result_json, expires_at=excluded.expires_at", (email_hash, json.dumps(result, ensure_ascii=False), now + 300))

    def uncache(self, email_hash):
        self.query("DELETE FROM ggsafe_cache WHERE email_hash = ?", (email_hash,))

    def rate(self, owner, now):
        # 증가 결과를 받을 때 실패했더라도 다시 증가시키지 않는다.
        return self.query("INSERT INTO ggsafe_rate (rate_key,count,window_start) VALUES (?,1,?) ON CONFLICT(rate_key) DO UPDATE SET count=ggsafe_rate.count+1 RETURNING count", (f"{owner}:{int(now // 60)}", now), retry=False)[0]["count"]

    def acquire(self, email_hash, token, now):
        return bool(self.query("INSERT INTO ggsafe_leases (email_hash,token,expires_at) VALUES (?,?,?) ON CONFLICT(email_hash) DO UPDATE SET token=excluded.token, expires_at=excluded.expires_at WHERE ggsafe_leases.expires_at <= ? RETURNING token", (email_hash, token, now + 25, now), retry=False))

    def release(self, email_hash, token):
        self.query("DELETE FROM ggsafe_leases WHERE email_hash = ? AND token = ?", (email_hash, token))

    def cleanup(self, now):
        def operation():
            with self.connection() as connection:
                for sql, cutoff in (("DELETE FROM ggsafe_history WHERE created_at < ?", iso(now - 30 * 86400)), ("DELETE FROM ggsafe_cache WHERE expires_at <= ?", now), ("DELETE FROM ggsafe_rate WHERE window_start < ?", now - 3600), ("DELETE FROM ggsafe_leases WHERE expires_at <= ?", now)):
                    self.execute(connection, sql, (cutoff,))
        storage_retry(operation)
