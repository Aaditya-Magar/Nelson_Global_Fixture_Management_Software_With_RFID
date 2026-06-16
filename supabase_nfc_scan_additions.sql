alter table racks add column if not exists nfc_tag_id text unique;
alter table rows add column if not exists nfc_tag_id text unique;
alter table fixtures add column if not exists nfc_tag_id text unique;

alter table requests add column if not exists scan1_rack_verified boolean default false;
alter table requests add column if not exists scan1_rack_at timestamptz;
alter table requests add column if not exists scan1_row_verified boolean default false;
alter table requests add column if not exists scan1_row_at timestamptz;
alter table requests add column if not exists scan1_fixture_verified boolean default false;
alter table requests add column if not exists scan1_fixture_at timestamptz;

create table if not exists nfc_registration_log (
  id uuid primary key default gen_random_uuid(),
  registered_by uuid references profiles on delete set null,
  entity_type text check (entity_type in ('rack', 'row', 'fixture')),
  entity_id uuid not null,
  nfc_tag_id text not null,
  registered_at timestamptz default now()
);

alter table nfc_registration_log enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'nfc_registration_log'
      and policyname = 'admin manage nfc_registration_log'
  ) then
    create policy "admin manage nfc_registration_log"
      on nfc_registration_log for all
      using (get_my_role() = 'admin');
  end if;
end $$;
