import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import connect_postgres, redact_error, supabase

SQL = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "001_init.sql"


def split_sql(sql: str) -> list[str]:
    parts: list[str] = []
    buf: list[str] = []
    for line in sql.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        buf.append(line)
        if stripped.endswith(";"):
            stmt = "\n".join(buf).strip().rstrip(";").strip()
            if stmt:
                parts.append(stmt)
            buf = []
    leftover = "\n".join(buf).strip().rstrip(";").strip()
    if leftover:
        parts.append(leftover)
    return parts


def schema_ready() -> bool:
    try:
        sb = supabase()
        sb.table("scanner_control").select("id").eq("id", 1).limit(1).execute()
        sb.table("bider_settings").select("id").eq("id", 1).limit(1).execute()
        sb.table("scanner_sources").select("id").limit(1).execute()
        sb.table("jobs").select("id").limit(1).execute()
        sb.table("job_events").select("id").limit(1).execute()
        return True
    except Exception:
        return False


def seed_via_supabase() -> None:
    sb = supabase()
    sb.table("scanner_control").upsert({"id": 1}).execute()
    sb.table("bider_settings").upsert({"id": 1}).execute()


def apply_via_postgres() -> None:
    statements = split_sql(SQL.read_text(encoding="utf-8"))
    print(f"Connecting and applying {len(statements)} SQL statements...")
    with connect_postgres() as conn:
        conn.autocommit = True
        for stmt in statements:
            try:
                conn.execute(stmt)
            except Exception as exc:
                msg = redact_error(exc).lower()
                if "already exists" in msg or "duplicate" in msg:
                    continue
                raise
        try:
            conn.execute("notify pgrst, 'reload schema'")
        except Exception:
            pass


def main() -> None:
    print("Checking existing schema via supabase-py...")
    if schema_ready():
        try:
            seed_via_supabase()
        except Exception as exc:
            print(f"Schema present; seed skipped: {redact_error(exc)}")
        else:
            print("Schema already present (verified via supabase-py).")
        return

    print("Tables missing. Trying Postgres (pooler, then direct)...")
    pg_error = None
    try:
        apply_via_postgres()
        for _ in range(8):
            if schema_ready():
                print("Migration applied via Postgres.")
                return
            time.sleep(1)
        print("Postgres SQL ran but tables are not visible via supabase-py yet.")
        return
    except Exception as exc:
        pg_error = redact_error(exc)
        print(f"Postgres apply failed: {pg_error}")

    try:
        seed_via_supabase()
        if schema_ready():
            print("Tables reachable via supabase-py; seed rows upserted.")
            return
    except Exception as sb_exc:
        print("Migration failed.")
        print(f"Postgres: {pg_error}")
        print(f"supabase-py: {redact_error(sb_exc)}")
        print("App can still start; dashboard APIs will return empty defaults until SQL is applied.")
        sys.exit(0)

    print("Migration failed.")
    print(f"Postgres: {pg_error}")
    print("App can still start; apply supabase/migrations/001_init.sql in the Supabase SQL editor.")
    sys.exit(0)


if __name__ == "__main__":
    main()
