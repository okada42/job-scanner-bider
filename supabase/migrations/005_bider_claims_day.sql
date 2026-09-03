alter table bider_claims add column if not exists day text;
create index if not exists bider_claims_actor_day_idx on bider_claims (actor, day, status);
