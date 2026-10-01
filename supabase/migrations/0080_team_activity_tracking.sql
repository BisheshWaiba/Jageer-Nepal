-- Lets a reseller keep tabs on their employees:
--
-- 1. service_requests.assigned_at - when the job was last offered to its
--    technician. Stamped by a trigger (never trusted from the client), so the
--    reseller can see assigned -> accepted (job_cards.started_at) ->
--    completed (job_cards.completed_at) for every job.
--
-- 2. technician_locations - the technician's live position, one row each.
--    Kept apart from profiles on purpose: profiles are readable by every
--    signed-in user, but a live position should only be visible to the
--    technician, the reseller who currently employs them, and admins.
--    The app only writes it while the technician is on shift for an employer.

-- 1. assigned_at ---------------------------------------------------------

alter table service_requests add column if not exists assigned_at timestamptz;

-- Best-effort backfill for jobs already past the offer stage.
update service_requests sr
set assigned_at = coalesce(
  (select jc.started_at from job_cards jc where jc.service_request_id = sr.id limit 1),
  sr.updated_at
)
where sr.assigned_at is null and sr.technician_id is not null;

create or replace function service_requests_set_assigned_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.assigned_at := case when new.status = 'assigned' then now() else null end;
  elsif new.status = 'assigned'
        and (old.status is distinct from 'assigned' or new.technician_id is distinct from old.technician_id) then
    new.assigned_at := now();
  else
    -- Not an offer: keep whatever was stamped, whatever the client sent.
    new.assigned_at := old.assigned_at;
  end if;
  return new;
end;
$$;

drop trigger if exists service_requests_set_assigned_at on service_requests;
create trigger service_requests_set_assigned_at
  before insert or update on service_requests
  for each row execute function service_requests_set_assigned_at();

-- 2. technician_locations ------------------------------------------------

create table if not exists technician_locations (
  technician_id uuid primary key references profiles(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  updated_at timestamptz not null default now()
);

alter table technician_locations enable row level security;

create policy technician_locations_select on technician_locations
  for select using (
    technician_id = auth.uid()
    or is_admin()
    or exists (
      select 1 from technician_employment e
      where e.technician_id = technician_locations.technician_id
        and e.reseller_id = auth.uid()
        and e.status = 'accepted'
    )
  );

create policy technician_locations_insert_own on technician_locations
  for insert with check (technician_id = auth.uid());

create policy technician_locations_update_own on technician_locations
  for update using (technician_id = auth.uid()) with check (technician_id = auth.uid());

create policy technician_locations_delete_own on technician_locations
  for delete using (technician_id = auth.uid());
