from __future__ import annotations

import json
import re
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.config import local_db_path
from app.core.priority import MANUAL_PRIORITY

DEFAULT_CONTROL = {
    "id": 1,
    "enabled": False,
    "platforms": {"crowdworks": True, "lancers": True, "coconala": True},
    "record_all": True,
    "excluded_clients": [],
}

DEFAULT_BIDER = {
    "id": 1,
    "enabled": True,
    "mode": "semi-auto",
    "max_active_jobs": 1,
    "max_queue_size": 100,
    "delay_between_jobs": 5,
    "auto_next": False,
}

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None
_connected_path: Path | None = None

SCHEMA = """
create table if not exists scanner_control (
  id integer primary key check (id = 1),
  enabled integer not null default 0,
  platforms text not null default '{"crowdworks": true, "lancers": true, "coconala": true}',
  record_all integer not null default 1,
  excluded_clients text not null default '[]',
  updated_at text
);
create table if not exists scanner_sources (
  id text primary key,
  name text,
  platform text not null,
  url text not null,
  enabled integer not null default 1,
  scan_interval integer not null default 60,
  rules text not null default '{}',
  last_scanned_at text,
  last_error text,
  last_job_count integer,
  last_listing_total integer,
  created_at text not null,
  updated_at text not null
);
create table if not exists jobs (
  id text primary key,
  platform text not null,
  external_job_id text not null,
  url text not null,
  title text,
  client text,
  budget text,
  deadline text,
  application_count integer,
  category text,
  detected_at text not null,
  status text not null default 'NEW',
  priority integer not null default 0,
  matched integer not null default 0,
  source_id text,
  created_at text not null,
  updated_at text not null,
  unique (platform, external_job_id)
);
create unique index if not exists jobs_platform_url_idx on jobs (platform, url);
create table if not exists bider_settings (
  id integer primary key check (id = 1),
  enabled integer not null default 1,
  mode text not null default 'semi-auto',
  max_active_jobs integer not null default 1,
  max_queue_size integer not null default 100,
  delay_between_jobs integer not null default 5,
  auto_next integer not null default 0,
  updated_at text
);
create table if not exists job_events (
  id text primary key,
  job_id text,
  event text not null,
  timestamp text not null,
  metadata text not null default '{}'
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def reset() -> None:
    global _conn, _connected_path
    with _lock:
        if _conn is not None:
            _conn.close()
        _conn = None
        _connected_path = None


def connect() -> sqlite3.Connection:
    global _conn, _connected_path
    path = local_db_path().resolve()
    with _lock:
        if _conn is not None and _connected_path == path:
            return _conn
        if _conn is not None:
            _conn.close()
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(SCHEMA)
        cols = {r[1] for r in conn.execute("pragma table_info(scanner_control)").fetchall()}
        if "excluded_clients" not in cols:
            conn.execute("alter table scanner_control add column excluded_clients text not null default '[]'")
        source_cols = {r[1] for r in conn.execute("pragma table_info(scanner_sources)").fetchall()}
        if "last_listing_total" not in source_cols:
            conn.execute("alter table scanner_sources add column last_listing_total integer")
        conn.execute(
            """create table if not exists bider_claims (
              job_id text not null,
              actor text not null,
              status text not null,
              url text,
              updated_at text not null,
              primary key (job_id, actor)
            )"""
        )
        conn.execute("create index if not exists bider_claims_actor_idx on bider_claims (actor, status)")
        claim_cols = {r[1] for r in conn.execute("pragma table_info(bider_claims)").fetchall()}
        if "day" not in claim_cols:
            conn.execute("alter table bider_claims add column day text")
        conn.execute(
            """create table if not exists bider_actors (
              actor text primary key,
              updated_at text not null,
              day text
            )"""
        )
        conn.execute(
            "insert or ignore into scanner_control (id, enabled, platforms, record_all, updated_at) values (1, 0, ?, 1, ?)",
            (json.dumps(DEFAULT_CONTROL["platforms"]), now_iso()),
        )
        conn.execute(
            "insert or ignore into bider_settings (id, enabled, mode, max_active_jobs, max_queue_size, delay_between_jobs, auto_next, updated_at) values (1, 1, 'semi-auto', 1, 100, 5, 0, ?)",
            (now_iso(),),
        )
        conn.commit()
        _conn = conn
        _connected_path = path
        return conn


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value in (0, 1):
        return bool(value)
    return bool(value)


def _load_json(value: Any, default: Any):
    if value is None or value == "":
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def _control_row(row: sqlite3.Row) -> dict:
    keys = row.keys()
    return {
        "id": row["id"],
        "enabled": _as_bool(row["enabled"]),
        "platforms": _load_json(row["platforms"], dict(DEFAULT_CONTROL["platforms"])),
        "record_all": _as_bool(row["record_all"]),
        "excluded_clients": _load_json(row["excluded_clients"] if "excluded_clients" in keys else "[]", []),
        "updated_at": row["updated_at"],
    }


def _bider_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "enabled": _as_bool(row["enabled"]),
        "mode": row["mode"],
        "max_active_jobs": row["max_active_jobs"],
        "max_queue_size": row["max_queue_size"],
        "delay_between_jobs": row["delay_between_jobs"],
        "auto_next": _as_bool(row["auto_next"]),
        "updated_at": row["updated_at"],
    }


def _source_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "platform": row["platform"],
        "url": row["url"],
        "enabled": _as_bool(row["enabled"]),
        "scan_interval": row["scan_interval"],
        "rules": _load_json(row["rules"], {}),
        "last_scanned_at": row["last_scanned_at"],
        "last_error": row["last_error"],
        "last_job_count": row["last_job_count"],
        "last_listing_total": row["last_listing_total"] if "last_listing_total" in row.keys() else None,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _job_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "platform": row["platform"],
        "external_job_id": row["external_job_id"],
        "url": row["url"],
        "title": row["title"],
        "client": row["client"],
        "budget": row["budget"],
        "deadline": row["deadline"],
        "application_count": row["application_count"],
        "category": row["category"],
        "detected_at": row["detected_at"],
        "status": row["status"],
        "priority": row["priority"],
        "matched": _as_bool(row["matched"]),
        "source_id": row["source_id"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "status_at": row["status_at"] if "status_at" in row.keys() and row["status_at"] else row["updated_at"],
    }


def add_event(job_id: str, event: str, metadata: dict[str, Any] | None = None) -> None:
    conn = connect()
    with _lock:
        conn.execute(
            "insert into job_events (id, job_id, event, timestamp, metadata) values (?, ?, ?, ?, ?)",
            (str(uuid4()), job_id, event, now_iso(), json.dumps(metadata or {})),
        )
        conn.commit()


def get_control() -> dict:
    conn = connect()
    row = conn.execute("select * from scanner_control where id = 1").fetchone()
    return _control_row(row) if row else dict(DEFAULT_CONTROL)


def update_control(patch: dict) -> dict:
    current = get_control()
    merged = {**current, **patch, "updated_at": now_iso()}
    conn = connect()
    with _lock:
        conn.execute(
            "update scanner_control set enabled = ?, platforms = ?, record_all = ?, excluded_clients = ?, updated_at = ? where id = 1",
            (
                1 if merged.get("enabled") else 0,
                json.dumps(merged.get("platforms") or DEFAULT_CONTROL["platforms"]),
                1 if merged.get("record_all", True) else 0,
                json.dumps(merged.get("excluded_clients") or []),
                merged["updated_at"],
            ),
        )
        conn.commit()
    return get_control()


def get_bider_settings() -> dict:
    conn = connect()
    row = conn.execute("select * from bider_settings where id = 1").fetchone()
    return _bider_row(row) if row else dict(DEFAULT_BIDER)


def update_bider_settings(patch: dict) -> dict:
    current = get_bider_settings()
    merged = {**current, **patch, "updated_at": now_iso()}
    conn = connect()
    with _lock:
        conn.execute(
            """update bider_settings set enabled = ?, mode = ?, max_active_jobs = ?,
               max_queue_size = ?, delay_between_jobs = ?, auto_next = ?, updated_at = ? where id = 1""",
            (
                1 if merged.get("enabled") else 0,
                merged.get("mode") or "semi-auto",
                int(merged.get("max_active_jobs") or 1),
                int(merged.get("max_queue_size") or 100),
                int(merged.get("delay_between_jobs") or 5),
                1 if merged.get("auto_next") else 0,
                merged["updated_at"],
            ),
        )
        conn.commit()
    return get_bider_settings()


def list_sources() -> list[dict]:
    conn = connect()
    rows = conn.execute("select * from scanner_sources order by created_at").fetchall()
    return [_source_row(r) for r in rows]


def job_counts_by_source() -> dict[str, int]:
    conn = connect()
    rows = conn.execute(
        """select source_id, count(*) as n from jobs
           where source_id is not null and source_id != ''
           group by source_id"""
    ).fetchall()
    return {str(r["source_id"]): int(r["n"]) for r in rows if r["source_id"]}


def job_counts_since_by_source(since_iso: str) -> dict[str, int]:
    """New jobs recorded at or after since_iso, excluding first-crawl baseline rows."""
    bound = (since_iso or "").replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(bound)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        prefix = parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    except ValueError:
        prefix = bound[:19]
    conn = connect()
    rows = conn.execute(
        """select j.source_id, count(*) as n from jobs j
           where j.source_id is not null and j.source_id != ''
             and j.created_at >= ?
             and not exists (
               select 1 from job_events e
               where e.job_id = j.id and e.event = 'BASELINE'
             )
           group by j.source_id""",
        (prefix,),
    ).fetchall()
    return {str(r["source_id"]): int(r["n"]) for r in rows if r["source_id"]}


def get_source(source_id: str) -> dict | None:
    conn = connect()
    row = conn.execute("select * from scanner_sources where id = ?", (source_id,)).fetchone()
    return _source_row(row) if row else None


def insert_source(row: dict) -> dict:
    now = now_iso()
    source_id = str(row.get("id") or uuid4())
    conn = connect()
    with _lock:
        conn.execute(
            """insert into scanner_sources
               (id, name, platform, url, enabled, scan_interval, rules, last_scanned_at, last_error, last_job_count, last_listing_total, created_at, updated_at)
               values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                source_id,
                row.get("name"),
                row["platform"],
                row["url"],
                1 if row.get("enabled", True) else 0,
                int(row.get("scan_interval") or 60),
                json.dumps(row.get("rules") or {}),
                row.get("last_scanned_at"),
                row.get("last_error"),
                row.get("last_job_count"),
                row.get("last_listing_total"),
                now,
                now,
            ),
        )
        conn.commit()
    return get_source(source_id) or {**row, "id": source_id, "created_at": now, "updated_at": now}


def update_source(source_id: str, patch: dict) -> dict:
    current = get_source(source_id)
    if not current:
        raise KeyError(source_id)
    merged = {**current, **patch, "updated_at": now_iso()}
    conn = connect()
    with _lock:
        conn.execute(
            """update scanner_sources set name = ?, platform = ?, url = ?, enabled = ?, scan_interval = ?,
               rules = ?, last_scanned_at = ?, last_error = ?, last_job_count = ?, last_listing_total = ?, updated_at = ? where id = ?""",
            (
                merged.get("name"),
                merged["platform"],
                merged["url"],
                1 if merged.get("enabled", True) else 0,
                int(merged.get("scan_interval") or 60),
                json.dumps(merged.get("rules") or {}),
                merged.get("last_scanned_at"),
                merged.get("last_error"),
                merged.get("last_job_count"),
                merged.get("last_listing_total"),
                merged["updated_at"],
                source_id,
            ),
        )
        conn.commit()
    return get_source(source_id) or merged


def delete_source(source_id: str) -> None:
    conn = connect()
    with _lock:
        conn.execute("delete from scanner_sources where id = ?", (source_id,))
        conn.commit()


_AGE_STATUSES = ("PROCESSING", "COMPLETED", "SENT_TO_BIDER", "WAITING_FOR_USER")
_ACTIVE_STATUSES = ("SENT_TO_BIDER", "PROCESSING", "PROPOSAL_PAGE_READY", "WAITING_FOR_USER")
# Bider work is per Japan calendar day: anything detected before today's midnight is stale.
_STALE_STATUSES = ("QUEUED", *_ACTIVE_STATUSES)
_NEW_ONLY_SQL = """and not exists (
            select 1 from job_events e where e.job_id = jobs.id and e.event = 'BASELINE'
        )"""
# detected_at is stored as a UTC ISO string; compare on the second-precision prefix.
_TODAY_SQL = "and substr(jobs.detected_at, 1, 19) >= ?"


def _utc_prefix(iso: str) -> str:
    bound = (iso or "").replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(bound)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return bound[:19]


def day_bound() -> str:
    from app.core.clock import local_day_start_iso

    return _utc_prefix(local_day_start_iso())


def expire_stale_bider_jobs(before_iso: str | None = None) -> list[str]:
    """Mark Bider jobs detected before the current scanner day as EXPIRED. Returns job ids."""
    bound = _utc_prefix(before_iso) if before_iso else day_bound()
    conn = connect()
    placeholders = ",".join("?" * len(_STALE_STATUSES))
    rows = conn.execute(
        f"select id from jobs where status in ({placeholders}) and substr(detected_at, 1, 19) < ?",
        (*_STALE_STATUSES, bound),
    ).fetchall()
    ids = [str(r["id"]) for r in rows]
    if not ids:
        return []
    now = now_iso()
    with _lock:
        for jid in ids:
            conn.execute("update jobs set status = 'EXPIRED', updated_at = ? where id = ?", (now, jid))
            conn.execute(
                "insert into job_events (id, job_id, event, timestamp, metadata) values (?, ?, ?, ?, ?)",
                (str(uuid4()), jid, "EXPIRED", now, json.dumps({"reason": "day_rollover", "before": bound})),
            )
        conn.commit()
    return ids


def claims_store_ok() -> bool:
    return True
_STATUS_AT_SQL = f"""CASE WHEN jobs.status IN ({",".join(repr(s) for s in _AGE_STATUSES)}) THEN (
            select e.timestamp from job_events e
            where e.job_id = jobs.id and e.event = jobs.status
            order by e.timestamp desc limit 1
        ) ELSE jobs.updated_at END"""


def count_jobs(status: str | None = None, new_only: bool = False, exclude_status: str | None = None) -> int:
    conn = connect()
    extra = _NEW_ONLY_SQL if new_only else ""
    params: list = []
    where = "1=1"
    if status:
        where += " and status = ?"
        params.append(status)
    elif exclude_status:
        where += " and status != ?"
        params.append(exclude_status)
    row = conn.execute(f"select count(*) as n from jobs where {where} {extra}", params).fetchone()
    return int(row["n"] if row else 0)


def list_jobs(
    status: str | None = None,
    limit: int = 100,
    new_only: bool = False,
    offset: int = 0,
    exclude_status: str | None = None,
) -> list[dict]:
    conn = connect()
    extra = _NEW_ONLY_SQL if new_only else ""
    off = max(0, int(offset))
    lim = int(limit)
    params: list = []
    where = "1=1"
    if status:
        where += " and status = ?"
        params.append(status)
    elif exclude_status:
        where += " and status != ?"
        params.append(exclude_status)
    rows = conn.execute(
        f"select jobs.*, {_STATUS_AT_SQL} as status_at from jobs where {where} {extra} order by detected_at desc limit ? offset ?",
        (*params, lim, off),
    ).fetchall()
    return [_job_row(r) for r in rows]


def active_jobs(limit: int = 10) -> list[dict]:
    conn = connect()
    placeholders = ",".join("?" * len(_ACTIVE_STATUSES))
    rows = conn.execute(
        f"""select jobs.*, {_STATUS_AT_SQL} as status_at from jobs
            where status in ({placeholders}) {_TODAY_SQL}
            order by updated_at desc limit ?""",
        (*_ACTIVE_STATUSES, day_bound(), int(limit)),
    ).fetchall()
    return [_job_row(r) for r in rows]


def get_job(job_id: str) -> dict | None:
    conn = connect()
    row = conn.execute("select * from jobs where id = ?", (job_id,)).fetchone()
    return _job_row(row) if row else None


def find_job(platform: str, external_job_id: str | None, url: str) -> dict | None:
    conn = connect()
    if external_job_id:
        row = conn.execute(
            "select * from jobs where platform = ? and external_job_id = ? limit 1",
            (platform, str(external_job_id)),
        ).fetchone()
        if row:
            return _job_row(row)
    if url:
        row = conn.execute(
            "select * from jobs where platform = ? and url = ? limit 1",
            (platform, url),
        ).fetchone()
        if row:
            return _job_row(row)
    return None


def insert_job(row: dict) -> dict:
    now = now_iso()
    job_id = str(row.get("id") or uuid4())
    conn = connect()
    with _lock:
        conn.execute(
            """insert into jobs
               (id, platform, external_job_id, url, title, client, budget, deadline, application_count,
                category, detected_at, status, priority, matched, source_id, created_at, updated_at)
               values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                job_id,
                row["platform"],
                str(row["external_job_id"]),
                row["url"],
                row.get("title"),
                row.get("client"),
                row.get("budget"),
                row.get("deadline"),
                row.get("application_count"),
                row.get("category"),
                row.get("detected_at") or now,
                row.get("status") or "NEW",
                int(row.get("priority") or 0),
                1 if row.get("matched") else 0,
                row.get("source_id"),
                now,
                now,
            ),
        )
        conn.commit()
    return get_job(job_id) or {**row, "id": job_id}


def update_job(job_id: str, patch: dict) -> dict:
    current = get_job(job_id)
    if not current:
        raise KeyError(job_id)
    merged = {**current, **patch, "updated_at": now_iso()}
    conn = connect()
    with _lock:
        conn.execute(
            """update jobs set platform = ?, external_job_id = ?, url = ?, title = ?, client = ?, budget = ?,
               deadline = ?, application_count = ?, category = ?, detected_at = ?, status = ?, priority = ?,
               matched = ?, source_id = ?, updated_at = ? where id = ?""",
            (
                merged["platform"],
                merged["external_job_id"],
                merged["url"],
                merged.get("title"),
                merged.get("client"),
                merged.get("budget"),
                merged.get("deadline"),
                merged.get("application_count"),
                merged.get("category"),
                merged.get("detected_at"),
                merged.get("status"),
                int(merged.get("priority") or 0),
                1 if merged.get("matched") else 0,
                merged.get("source_id"),
                merged["updated_at"],
                job_id,
            ),
        )
        conn.commit()
    return get_job(job_id) or merged


def queued_jobs(limit: int = 50) -> list[dict]:
    conn = connect()
    extra = _NEW_ONLY_SQL
    rows = conn.execute(
        f"""select jobs.*, {_STATUS_AT_SQL} as status_at from jobs
            where status = 'QUEUED' {extra} {_TODAY_SQL}
            order by priority desc, detected_at desc limit ?""",
        (day_bound(), int(limit)),
    ).fetchall()
    return [_job_row(r) for r in rows]


def jobs_failed_discord(limit: int = 50) -> list[dict]:
    """Jobs whose Discord alert failed and has not been sent yet (retry queue)."""
    conn = connect()
    rows = conn.execute(
        """select j.* from jobs j
           where exists (
             select 1 from job_events e where e.job_id = j.id and e.event = 'DISCORD_FAILED'
           )
           and not exists (
             select 1 from job_events e where e.job_id = j.id and e.event = 'DISCORD_SENT'
           )
           and not exists (
             select 1 from job_events e where e.job_id = j.id and e.event = 'BASELINE'
           )
           order by j.detected_at
           limit ?""",
        (int(limit),),
    ).fetchall()
    return [_job_row(r) for r in rows]


def active_job_count() -> int:
    conn = connect()
    row = conn.execute(
        f"""select count(*) as n from jobs where status in
           ('SENT_TO_BIDER', 'PROCESSING', 'PROPOSAL_PAGE_READY', 'WAITING_FOR_USER') {_TODAY_SQL}""",
        (day_bound(),),
    ).fetchone()
    return int(row["n"] if row else 0)


_CLAIM_BLOCK = (
    "SENT_TO_BIDER",
    "PROCESSING",
    "PROPOSAL_PAGE_READY",
    "WAITING_FOR_USER",
    "COMPLETED",
    "SKIPPED",
)


def claim_day() -> str:
    from app.core.clock import scanner_zone

    return datetime.now(scanner_zone()).strftime("%Y-%m-%d")


def upsert_claim(job_id: str, actor: str, status: str, url: str | None = None) -> None:
    if not job_id or not actor:
        return
    conn = connect()
    now = now_iso()
    day = claim_day()
    with _lock:
        conn.execute(
            """insert into bider_claims (job_id, actor, status, url, updated_at, day)
               values (?, ?, ?, ?, ?, ?)
               on conflict(job_id, actor) do update set status = excluded.status, url = coalesce(excluded.url, bider_claims.url), updated_at = excluded.updated_at, day = excluded.day""",
            (job_id, actor, status, url, now, day),
        )
        conn.commit()


def actor_active_count(actor: str) -> int:
    if not actor:
        return active_job_count()
    conn = connect()
    placeholders = ",".join("?" * len(_ACTIVE_STATUSES))
    row = conn.execute(
        f"""select count(*) as n from bider_claims c
            join jobs j on j.id = c.job_id
            where c.actor = ? and c.day = ? and c.status in ({placeholders})
              and coalesce(j.priority, 0) < ?""",
        (actor, claim_day(), *_ACTIVE_STATUSES, MANUAL_PRIORITY),
    ).fetchone()
    return int(row["n"] if row else 0)


def actor_active_jobs(actor: str, limit: int = 10) -> list[dict]:
    if not actor:
        return active_jobs(limit)
    conn = connect()
    placeholders = ",".join("?" * len(_ACTIVE_STATUSES))
    day = claim_day()
    claims = {
        r["job_id"]: r["status"]
        for r in conn.execute(
            f"select job_id, status from bider_claims where actor = ? and day = ? and status in ({placeholders})",
            (actor, day, *_ACTIVE_STATUSES),
        ).fetchall()
    }
    out = []
    for jid, status in list(claims.items())[: int(limit)]:
        job = get_job(jid)
        if job:
            job["claim_status"] = status
            out.append(job)
    return out


def queued_for_actor(actor: str, limit: int = 50) -> list[dict]:
    if not actor:
        return queued_jobs(limit)
    conn = connect()
    block = ",".join("?" * len(_CLAIM_BLOCK))
    pool = ",".join("?" * 7)
    day = claim_day()
    rows = conn.execute(
        f"""select jobs.*, {_STATUS_AT_SQL} as status_at from jobs
            where jobs.status in ({pool})
            {_NEW_ONLY_SQL}
            {_TODAY_SQL}
            and not exists (
              select 1 from bider_claims c
              where c.job_id = jobs.id and c.actor = ? and c.day = ? and c.status in ({block})
            )
            order by jobs.priority desc, jobs.detected_at desc limit ?""",
        (
            "QUEUED",
            "SENT_TO_BIDER",
            "PROCESSING",
            "PROPOSAL_PAGE_READY",
            "WAITING_FOR_USER",
            "SKIPPED",
            "COMPLETED",
            day_bound(),
            actor,
            day,
            *_CLAIM_BLOCK,
            int(limit),
        ),
    ).fetchall()
    return [_job_row(r) for r in rows]


def actor_skipped_jobs(actor: str, limit: int = 20) -> list[dict]:
    if not actor:
        return list_jobs(status="SKIPPED", limit=limit, new_only=True)
    conn = connect()
    rows = conn.execute(
        f"""select jobs.*, {_STATUS_AT_SQL} as status_at from jobs
            join bider_claims c on c.job_id = jobs.id
            where c.actor = ? and c.day = ? and c.status = 'SKIPPED'
            order by c.updated_at desc limit ?""",
        (actor, claim_day(), int(limit)),
    ).fetchall()
    out = [_job_row(r) for r in rows]
    for job in out:
        job["claim_status"] = "SKIPPED"
    return out


def _platform_actor(actor: str) -> str:
    name = str(actor or "").strip()[:80]
    name = re.sub(r"さん$", "", name).strip()
    if not name or name.lower().startswith("ext-"):
        return ""
    return name


def touch_actor(actor: str) -> str:
    name = _platform_actor(actor)
    if not name:
        return ""
    conn = connect()
    with _lock:
        conn.execute(
            """insert into bider_actors (actor, updated_at, day) values (?, ?, ?)
               on conflict(actor) do update set updated_at = excluded.updated_at, day = excluded.day""",
            (name, now_iso(), claim_day()),
        )
        conn.commit()
    return name


def list_claim_actors() -> list[str]:
    conn = connect()
    rows = conn.execute(
        """select actor from bider_actors
           where actor is not null and trim(actor) != '' and lower(actor) not like 'ext-%'
           union
           select distinct actor from bider_claims
           where actor is not null and trim(actor) != '' and lower(actor) not like 'ext-%'
           order by 1 collate nocase"""
    ).fetchall()
    return [_platform_actor(r["actor"]) for r in rows if _platform_actor(r["actor"])]


def get_claim(job_id: str, actor: str) -> dict | None:
    if not job_id or not actor:
        return None
    conn = connect()
    row = conn.execute(
        "select job_id, actor, status, url, updated_at, day from bider_claims where job_id = ? and actor = ?",
        (job_id, actor),
    ).fetchone()
    if not row:
        return None
    return {
        "job_id": row["job_id"],
        "actor": row["actor"],
        "status": row["status"],
        "url": row["url"],
        "updated_at": row["updated_at"],
        "day": row["day"],
    }


def upsert_queued_claim(job_id: str, actor: str, url: str | None = None) -> None:
    name = _platform_actor(actor)
    if not job_id or not name:
        return
    current = get_claim(job_id, name)
    if current and str(current.get("day") or "") == claim_day() and current.get("status") in _CLAIM_BLOCK:
        return
    upsert_claim(job_id, name, "QUEUED", url)


def claims_for_jobs(job_ids: list[str]) -> dict[str, list[dict]]:
    ids = [str(jid) for jid in job_ids if jid]
    if not ids:
        return {}
    conn = connect()
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        f"""select job_id, actor, status, updated_at, day from bider_claims
            where day = ? and job_id in ({placeholders})
            order by actor collate nocase""",
        (claim_day(), *ids),
    ).fetchall()
    out: dict[str, list[dict]] = {}
    for row in rows:
        actor = str(row["actor"] or "").strip()
        jid = str(row["job_id"] or "")
        if not actor or not jid:
            continue
        out.setdefault(jid, []).append(
            {
                "actor": actor,
                "status": row["status"],
                "updated_at": row["updated_at"],
                "day": row["day"],
            }
        )
    return out
