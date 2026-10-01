-- A technician can no longer walk out of an employment on their own. They
-- ask to leave (leave_requested_at, plus an optional reason), the employer
-- sees it as a notification/popup, and the employment only ends when the
-- employer approves. The employer can instead reject it, which clears the
-- request and stamps leave_rejected_at so the technician is told no.
--
--   technician  : accepted + no request  -> sets leave_requested_at (+ reason)
--   technician  : request pending        -> may withdraw it (clears both)
--   employer    : request pending        -> approve = status 'ended'
--                                           reject  = clear request, stamp leave_rejected_at
--   employer can still remove an employee any time (accepted -> ended), as before.
--
-- Enforced here, not in the app: the old guard let EITHER side end an
-- accepted employment, and the technician policy lets them update their own
-- row, so a modified client could still have resigned unilaterally.

begin;

alter table technician_employment
  add column if not exists leave_requested_at timestamptz,
  add column if not exists leave_reason text,
  add column if not exists leave_rejected_at timestamptz;

create index if not exists technician_employment_leave_requests_idx
  on technician_employment (reseller_id)
  where status = 'accepted' and leave_requested_at is not null;

create or replace function technician_employment_guard_accept() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  other_party uuid;
  is_tech boolean;
  is_employer boolean;
begin
  if is_admin() then
    return new;
  end if;

  if new.technician_id is distinct from old.technician_id
     or new.reseller_id is distinct from old.reseller_id
     or new.initiated_by is distinct from old.initiated_by then
    raise exception 'The people on an employment request cannot be changed';
  end if;

  is_tech := auth.uid() = old.technician_id;
  is_employer := auth.uid() = old.reseller_id;

  if new.status is distinct from old.status then
    other_party := case when old.initiated_by = 'reseller' then old.technician_id else old.reseller_id end;

    if old.status = 'pending' and new.status in ('accepted', 'rejected') then
      if auth.uid() is distinct from other_party then
        raise exception 'Only the other side can accept or decline this request';
      end if;
    elsif old.status = 'pending' and new.status = 'ended' then
      null; -- either side can withdraw it
    elsif old.status = 'accepted' and new.status = 'ended' then
      -- Only the employer can end a live employment. A technician has to
      -- ask to leave (leave_requested_at) and be approved.
      if not is_employer then
        raise exception 'Your employer has to approve before you can leave - send a request to leave instead';
      end if;
    else
      raise exception 'An employment request cannot go from % to %', old.status, new.status;
    end if;
  end if;

  -- Leave-request fields ---------------------------------------------------
  -- leave_rejected_at is only ever stamped by the trigger itself.
  if new.leave_rejected_at is distinct from old.leave_rejected_at then
    raise exception 'leave_rejected_at is set automatically';
  end if;

  if new.leave_requested_at is distinct from old.leave_requested_at then
    if is_tech then
      if new.leave_requested_at is not null then
        -- Asking to leave.
        if old.status <> 'accepted' or new.status <> 'accepted' then
          raise exception 'You can only ask to leave a job you currently hold';
        end if;
        if old.leave_requested_at is not null then
          raise exception 'You have already asked to leave - wait for your employer to answer';
        end if;
        new.leave_requested_at := now();   -- server time, never the client's
        new.leave_rejected_at := null;     -- a fresh ask clears the old "declined" notice
      else
        -- Withdrawing the request.
        new.leave_reason := null;
      end if;
    elsif is_employer then
      if new.leave_requested_at is not null then
        raise exception 'Only the technician can ask to leave';
      end if;
      -- Rejecting: clearing the request. (Approving is status -> ended and
      -- leaves the request in place as a record.)
      new.leave_rejected_at := now();
    end if;
  end if;

  if new.leave_reason is distinct from old.leave_reason then
    -- Only alongside the technician filing or withdrawing a request.
    if not (is_tech and new.leave_requested_at is distinct from old.leave_requested_at) then
      raise exception 'The reason for leaving can only be set when asking to leave';
    end if;
  end if;

  return new;
end;
$$;

-- The employer's popup and the technician's "declined" notice both ride
-- realtime; this table was never published, so they would only have updated
-- on the slow poll. RLS (select_own) still decides who receives what.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'technician_employment'
  ) then
    alter publication supabase_realtime add table technician_employment;
  end if;
end $$;

commit;
