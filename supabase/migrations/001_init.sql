create extension if not exists pgcrypto;

create table if not exists scanner_control (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default false,
  platforms jsonb not null default '{"crowdworks": true, "lancers": true, "coconala": true}'::jsonb,
  record_all boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists scanner_sources (
  id uuid primary key default gen_random_uuid(),
  name text,
  platform text not null check (platform in ('crowdworks', 'lancers', 'coconala')),
  url text not null,
  enabled boolean not null default true,
  scan_interval integer not null default 20,
  rules jsonb not null default '{}'::jsonb,
  last_scanned_at timestamptz,
  last_error text,
  last_job_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  external_job_id text not null,
  url text not null,
  title text,
  client text,
  budget text,
  deadline text,
  application_count integer,
  category text,
  detected_at timestamptz not null default now(),
  status text not null default 'NEW',
  priority integer not null default 0,
  matched boolean not null default false,
  source_id uuid references scanner_sources(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, external_job_id)
);

create unique index if not exists jobs_platform_url_idx on jobs (platform, url);

create table if not exists bider_settings (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default true,
  mode text not null default 'semi-auto' check (mode in ('auto', 'semi-auto', 'paused')),
  max_active_jobs integer not null default 1,
  max_queue_size integer not null default 100,
  delay_between_jobs integer not null default 5,
  auto_next boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  event text not null,
  timestamp timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table scanner_control enable row level security;
alter table scanner_sources enable row level security;
alter table jobs enable row level security;
alter table bider_settings enable row level security;
alter table job_events enable row level security;

insert into scanner_control (id) values (1) on conflict (id) do nothing;
insert into bider_settings (id) values (1) on conflict (id) do nothing;
