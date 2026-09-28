-- Not everyone on a team only carries jobs: a supervisor hands them out.
-- An employment row now says which of the two a person is, and a
-- supervisor can see their employer's work and give it to teammates (or
-- open it to everyone) without being the reseller.
-- Additive only. Safe to run once against the existing schema.

alter table technician_employment
  add column if not exists staff_role text not null default 'technician';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'technician_employment_staff_role_check') then
    alter table technician_employment
      add constraint technician_employment_staff_role_check check (staff_role in ('technician', 'supervisor'));
  end if;
end;
$$;

-- The role is the employer's to set, like the work hours and job title
-- before it - a technician promoting themselves would be the whole point
-- of the permission gone. Replaces the guard from 0075.
create or replace function technician_employment_hours_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = new.technician_id
     and auth.uid() <> new.reseller_id
     and not is_admin()
     and (new.work_start_time is distinct from old.work_start_time
          or new.work_end_time is distinct from old.work_end_time
          or new.job_title is distinct from old.job_title
          or new.employer_note is distinct from old.employer_note
          or new.staff_role is distinct from old.staff_role) then
    raise exception 'work hours, job title and role are set by your employer';
  end if;
  return new;
end;
$$;

/** True when the caller supervises this reseller's team. */
create or replace function is_supervisor_for(p_reseller_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from technician_employment te
    where te.technician_id = auth.uid()
      and te.reseller_id = p_reseller_id
      and te.status = 'accepted'
      and te.staff_role = 'supervisor'
  );
$$;

grant execute on function is_supervisor_for(uuid) to authenticated;

-- A supervisor reads their employer's jobs (they are staffing them), on top
-- of everything service_requests_select already allows.
drop policy if exists service_requests_select_supervisor on service_requests;
create policy service_requests_select_supervisor on service_requests
  for select using (reseller_id is not null and is_supervisor_for(reseller_id));

-- Handing work out goes through these two, not a blanket update policy:
-- a supervisor can only move a job between their own teammates or open it
-- to the team, never change its price, its customer or anything else.
create or replace function supervisor_assign_job(p_request_id uuid, p_technician_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req service_requests%rowtype;
begin
  select * into req from service_requests where id = p_request_id for update;
  if not found then
    raise exception 'Job not found';
  end if;
  if not is_supervisor_for(req.reseller_id) then
    raise exception 'Only a supervisor of this team can hand out its work';
  end if;
  if req.status in ('resolved', 'cancelled') then
    raise exception 'This job is already finished';
  end if;
  if not exists (
    select 1 from technician_employment te
    where te.technician_id = p_technician_id
      and te.reseller_id = req.reseller_id
      and te.status = 'accepted'
  ) then
    raise exception 'That person is not on this team';
  end if;

  -- Same shape as the reseller assigning it: the offer rings on their
  -- phone and they accept or reject it (see technician_respond_to_job).
  update service_requests
  set technician_id = p_technician_id,
      status = 'assigned',
      open_to_team = false
  where id = p_request_id;
end;
$$;

grant execute on function supervisor_assign_job(uuid, uuid) to authenticated;

create or replace function supervisor_set_open_to_team(p_request_id uuid, p_open boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req service_requests%rowtype;
begin
  select * into req from service_requests where id = p_request_id for update;
  if not found then
    raise exception 'Job not found';
  end if;
  if not is_supervisor_for(req.reseller_id) then
    raise exception 'Only a supervisor of this team can hand out its work';
  end if;
  if p_open and req.technician_id is not null then
    raise exception 'Someone already has this job';
  end if;

  update service_requests set open_to_team = p_open where id = p_request_id;
end;
$$;

grant execute on function supervisor_set_open_to_team(uuid, boolean) to authenticated;

-- Who else is on the team, so a supervisor can pick someone. Names and
-- work hours only - nothing about the rest of the employer's business.
create or replace function my_team_roster()
returns table (
  technician_id uuid,
  full_name text,
  phone text,
  avatar_url text,
  job_title text,
  work_start_time time,
  work_end_time time,
  staff_role text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.phone, p.avatar_url, te.job_title, te.work_start_time, te.work_end_time, te.staff_role
  from technician_employment te
  join profiles p on p.id = te.technician_id
  where te.status = 'accepted'
    and te.reseller_id in (
      select mine.reseller_id from technician_employment mine
      where mine.technician_id = auth.uid()
        and mine.status = 'accepted'
        and mine.staff_role = 'supervisor'
    );
$$;

grant execute on function my_team_roster() to authenticated;
