create table if not exists bider_claims (
  job_id uuid not null references jobs(id) on delete cascade,
  actor text not null,
  status text not null,
  url text,
  updated_at timestamptz not null default now(),
  primary key (job_id, actor)
);

create index if not exists bider_claims_actor_idx on bider_claims (actor, status);

alter table bider_claims enable row level security;
