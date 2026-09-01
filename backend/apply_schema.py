from pathlib import Path
import os

import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

STATEMENTS = [
    "create extension if not exists pgcrypto",
    """
    create table if not exists scanner_control (
      id int primary key default 1 check (id = 1),
      overall_enabled boolean not null default false,
      platform_enabled jsonb not null default '{"crowdworks": true, "lancers": true, "coconala": true}'::jsonb,
      updated_at timestamptz not null default now()
    )
    """,
    "insert into scanner_control (id) values (1) on conflict (id) do nothing",
    """
    create table if not exists scanner_sources (
      id uuid primary key default gen_random_uuid(),
      platform text not null check (platform in ('crowdworks', 'lancers', 'coconala')),
      name text,
      url text not null,
      enabled boolean not null default true,
      scan_interval integer not null default 20,
      rules jsonb not null default '{}'::jsonb,
      last_scanned_at timestamptz,
      last_error text,
      last_job_count integer,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
    """,
    """
    create table if not exists jobs (
      id uuid primary key default gen_random_uuid(),
      platform text not null,
      external_job_id text not null,
      url text not null,
      title text,
      client text,
      budget text,
      budget_min integer,
      budget_max integer,
      deadline text,
      application_count integer,
      category text,
      detected_at timestamptz not null default now(),
      status text not null default 'NEW',
      priority integer not null default 0,
      matched boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (platform, external_job_id)
    )
    """,
    "create index if not exists jobs_status_idx on jobs (status, detected_at desc)",
    "create index if not exists jobs_url_idx on jobs (platform, url)",
    """
    create table if not exists bider_settings (
      id int primary key default 1 check (id = 1),
      enabled boolean not null default true,
      mode text not null default 'semi-auto' check (mode in ('auto', 'semi-auto', 'paused')),
      max_active_jobs integer not null default 1,
      max_queue_size integer not null default 50,
      delay_between_jobs integer not null default 5,
      auto_next boolean not null default false,
      updated_at timestamptz not null default now()
    )
    """,
    "insert into bider_settings (id) values (1) on conflict (id) do nothing",
    """
    create table if not exists job_events (
      id uuid primary key default gen_random_uuid(),
      job_id uuid references jobs(id) on delete cascade,
      event text not null,
      timestamp timestamptz not null default now(),
      metadata jsonb not null default '{}'::jsonb
    )
    """,
    """
    create or replace function set_updated_at()
    returns trigger as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$ language plpgsql
    """,
    "drop trigger if exists scanner_sources_updated_at on scanner_sources",
    """
    create trigger scanner_sources_updated_at before update on scanner_sources
    for each row execute function set_updated_at()
    """,
    "drop trigger if exists jobs_updated_at on jobs",
    """
    create trigger jobs_updated_at before update on jobs
    for each row execute function set_updated_at()
    """,
    "alter table scanner_control enable row level security",
    "alter table scanner_sources enable row level security",
    "alter table jobs enable row level security",
    "alter table bider_settings enable row level security",
    "alter table job_events enable row level security",
]


def main():
    url = os.environ["SUPABASE_DB_URL"].strip().strip('"')
    with psycopg.connect(url) as conn:
        for stmt in STATEMENTS:
            conn.execute(stmt)
        conn.commit()
    print("schema applied")


if __name__ == "__main__":
    main()
