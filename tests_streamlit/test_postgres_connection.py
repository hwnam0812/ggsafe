import psycopg

from ggsafe_streamlit.storage import POSTGRES_SCHEMA, SCHEMA, Store


class Connection:
    def __init__(self):
        self.commands = []
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, values=()):
        self.commands.append((sql, values))

    def close(self):
        self.closed = True


def test_postgres_connections_encrypt_and_disable_prepared_statements(monkeypatch):
    connection = Connection()
    arguments = {}

    def connect(url, **kwargs):
        arguments.update(kwargs)
        assert url == "postgresql://synthetic"
        return connection

    monkeypatch.setattr(psycopg, "connect", connect)
    store = Store(database_url="postgresql://synthetic").prepare()
    assert isinstance(store, Store)
    assert arguments["sslmode"] == "require"
    assert arguments["prepare_threshold"] is None
    assert arguments["options"] == "-c search_path=public"
    assert arguments["connect_timeout"] == 8
    assert connection.closed
    assert connection.commands[0][0] == "SELECT pg_advisory_xact_lock(1734821631)"
    assert connection.commands[1][0] == POSTGRES_SCHEMA.read_text(encoding="utf-8")


def test_postgres_migration_keeps_existing_tables_and_denies_client_roles():
    migration = POSTGRES_SCHEMA.read_text(encoding="utf-8")
    normalized = " ".join(migration.split())
    for table in ["ggsafe_history", "ggsafe_cache", "ggsafe_rate", "ggsafe_leases"]:
        assert f"CREATE TABLE IF NOT EXISTS public.{table}" in normalized
        assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY" in normalized
    assert "FROM anon" in normalized and "FROM authenticated" in normalized and "FROM PUBLIC" in normalized
    assert "DROP " not in migration and "DELETE " not in migration and "TRUNCATE " not in migration
    assert len(SCHEMA) == 5
    assert POSTGRES_SCHEMA.is_file()
