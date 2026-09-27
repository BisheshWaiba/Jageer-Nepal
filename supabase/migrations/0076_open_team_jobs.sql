-- Work a reseller puts in front of their whole team instead of handing it
-- to one person: the employees see it in their own portal and the first to
-- accept it gets it. Direct assignment (technician_id + status 'assigned',
-- which rings on their phone) is unchanged - this is the other half of it.
-- Additive only. Safe to run once against the existing schema.

alter table service_requests add column if not exists open_to_team boolean not null default false;

create index if not exists service_requests_open_to_team_idx
  on service_requests (reseller_id)
  where open_to_team and technician_id is null;

-- An employee can read their employer's open work. Everything else about
-- who sees what is untouched (service_requests_select still governs their
-- own jobs, the client's, the reseller's and the pending pool).
drop policy if exists service_requests_select_open_team on service_requests;
create policy service_requests_select_open_team on service_requests
  for select using (
    open_to_team
    and technician_id is null
    and exists (
      select 1 from technician_employment te
      where te.technician_id = auth.uid()
        and te.reseller_id = service_requests.reseller_id
        and te.status = 'accepted'
    )
  );

-- Claiming is first-come: the row is locked, checked and taken in one go,
-- so two employees tapping Accept at the same moment can't both get it.
-- Taking a job starts it (same as accepting a direct offer), which is why
-- it also opens the job card.
create or replace function claim_open_job(p_request_id uuid)
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
  if not req.open_to_team or req.technician_id is not null then
    raise exception 'Someone else has already taken this job';
  end if;
  if not exists (
    select 1 from technician_employment te
    where te.technician_id = auth.uid()
      and te.reseller_id = req.reseller_id
      and te.status = 'accepted'
  ) then
    raise exception 'This job is only open to that reseller''s own team';
  end if;

  update service_requests
  set technician_id = auth.uid(),
      status = 'in_progress',
      open_to_team = false
  where id = p_request_id;

  if not exists (select 1 from job_cards where service_request_id = p_request_id) then
    insert into job_cards (service_request_id, technician_id, started_at)
    values (p_request_id, auth.uid(), now());
  end if;
end;
$$;

grant execute on function claim_open_job(uuid) to authenticated;
