alter table scanner_control
  add column if not exists excluded_clients jsonb not null default '[]'::jsonb;
