create table if not exists bider_actors (
  actor text primary key,
  updated_at timestamptz not null default now(),
  day text
);

alter table bider_actors enable row level security;
