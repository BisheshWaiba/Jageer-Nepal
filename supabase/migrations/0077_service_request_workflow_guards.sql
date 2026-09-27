-- Closes the gaps found walking the customer -> reseller -> technician flow:
--
-- 1. One amount per job. The customer approves quoted_price, but the Fonepay
--    QR and the payment credit charged the technician's job card total
--    while the ledger debit used quoted_price - so the customer could be
--    charged a price they never approved, and the ledger never netted to
--    zero. service_request_amount() is now the single rule everywhere: the
--    agreed quoted_price when there is one, otherwise (a walk-in job the
--    reseller never priced) the job card total. The Edge Function
--    fonepay-create-qr mirrors the same rule.
--
-- 2. Column / status guard. The update policy lets the client, reseller and
--    technician write any column on a row they're part of, so a customer
--    could mark their own job paid, change the approved price, or resolve
--    it through the API. service_requests_guard_update() pins down who may
--    change what, and which status moves each party may make. It only
--    applies to direct API writes (current_user = 'authenticated'):
--    SECURITY DEFINER functions (the job RPCs, the ledger triggers) run as
--    the function owner and the Edge Functions run as service_role, and
--    each of those already checks permission itself.
--    service_requests_guard_insert() does the same for new rows, so a new
--    request always starts as an unpaid, unassigned 'pending' job.
--
-- 3. claim_service_request(): claiming an incoming app request is now a
--    locked "only if nobody has it yet" check instead of a blind write, so
--    two resellers can't both claim (or overwrite) the same request.
--
-- 4. withdraw_job_offer(): a reseller can take back a job a technician
--    hasn't answered, instead of it sitting in 'assigned' forever.
--
-- 5. Holds: finishing or cancelling a job clears a pending hold request,
--    a job that is actually on hold must be resumed before it can be marked
--    complete, a hold can only be answered on a job that is in progress, and
--    reopening a job starts it with no hold.
--
-- 6. Reward points: a reseller's own walk-in job stores the reseller as
--    client_id, so completing one gave the reseller both the "client" and
--    the "reseller" point. Only award the client point to a real customer,
--    and take back the duplicates already given.

-- 1. One amount per job ------------------------------------------------------

create or replace function service_request_amount(p_request_id uuid, p_quoted_price numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_quoted_price is not null and p_quoted_price > 0 then p_quoted_price
    else (
      select nullif(coalesce(labor_cost, 0) + coalesce(parts_cost, 0), 0)
      from job_cards
      where service_request_id = p_request_id
      order by created_at
      limit 1
    )
  end
$$;

revoke all on function service_request_amount(uuid, numeric) from public;

create or replace function sync_service_request_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  amount numeric;
begin
  amount := service_request_amount(new.id, new.quoted_price);

  if new.customer_id is null or amount is null or amount <= 0 or new.status <> 'resolved' then
    delete from customer_ledger_entries where source_type = 'service_request' and source_id = new.id;
    return new;
  end if;

  insert into customer_ledger_entries (customer_id, owner_id, entry_type, amount, note, source, source_type, source_id)
  values (new.customer_id, new.reseller_id, 'debit', amount, new.issue_type, 'booking', 'service_request', new.id)
  on conflict (source_type, source_id) where source_type is not null and source_id is not null
  do update set amount = excluded.amount, customer_id = excluded.customer_id, note = excluded.note;

  return new;
end;
$$;

create or replace function sync_service_request_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  paid_amount numeric;
begin
  if new.payment_status = 'paid' and (old.payment_status is distinct from 'paid') then
    paid_amount := service_request_amount(new.id, new.quoted_price);
    if paid_amount is null or paid_amount <= 0 or new.reseller_id is null then
      return new;
    end if;

    if new.customer_id is not null then
      insert into customer_ledger_entries (customer_id, owner_id, entry_type, amount, note, source, source_type, source_id)
      values (new.customer_id, new.reseller_id, 'credit', paid_amount, new.issue_type, 'booking', 'service_request_payment', new.id)
      on conflict (source_type, source_id) where source_type is not null and source_id is not null
      do update set amount = excluded.amount;
    else
      insert into business_transactions (owner_id, type, amount, note, party_name, source_type, source_id)
      values (new.reseller_id, 'sale', paid_amount, new.issue_type, new.customer_name, 'service_request_payment', new.id)
      on conflict (source_type, source_id) where source_type is not null and source_id is not null
      do update set amount = excluded.amount;
    end if;
  elsif new.payment_status <> 'paid' and old.payment_status = 'paid' then
    delete from customer_ledger_entries where source_type = 'service_request_payment' and source_id = new.id;
    delete from business_transactions where source_type = 'service_request_payment' and source_id = new.id;
  end if;

  return new;
end;
$$;

-- Walk-in jobs finished without a quoted price never got a debit (the old
-- rule only looked at quoted_price) even though their payment was credited
-- from the job card - backfill the missing debit so they net to zero.
-- Existing payment credits are left as recorded: they reflect money that
-- was actually collected.
insert into customer_ledger_entries (customer_id, owner_id, entry_type, amount, note, source, source_type, source_id)
select sr.customer_id, sr.reseller_id, 'debit', service_request_amount(sr.id, sr.quoted_price), sr.issue_type, 'booking', 'service_request', sr.id
from service_requests sr
where sr.status = 'resolved'
  and sr.customer_id is not null
  and sr.reseller_id is not null
  and coalesce(service_request_amount(sr.id, sr.quoted_price), 0) > 0
on conflict (source_type, source_id) where source_type is not null and source_id is not null do nothing;

-- 2. Insert / update guard ----------------------------------------------------

create or replace function service_requests_guard_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if current_user not in ('authenticated', 'anon') or is_admin() then
    return new;
  end if;

  if new.status is distinct from 'pending'
     or new.payment_status is distinct from 'unpaid'
     or new.paid_at is not null
     or new.technician_id is not null
     or new.fonepay_prn is not null
     or new.hold_status is distinct from 'none' then
    raise exception 'A new request must start as an unpaid, unassigned pending job';
  end if;

  if new.origin = 'reseller' then
    if new.reseller_id is distinct from uid then
      raise exception 'You can only create requests for your own shop';
    end if;
    if new.customer_id is not null
       and not exists (select 1 from customers c where c.id = new.customer_id and c.owner_id = uid) then
      raise exception 'That customer is not in your customer list';
    end if;
  else
    if new.reseller_id is not null or new.quoted_price is not null or new.customer_id is not null then
      raise exception 'A reseller sets the price after accepting the request';
    end if;
  end if;

  return new;
end;
$$;

create or replace function service_requests_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  acting_reseller boolean;
  acting_client boolean;
  acting_technician boolean;
  allowed boolean;
begin
  if current_user in ('authenticated', 'anon') and not is_admin() then
    if new.client_id is distinct from old.client_id or new.origin is distinct from old.origin then
      raise exception 'The customer on a request cannot be changed';
    end if;
    if new.fonepay_prn is distinct from old.fonepay_prn then
      raise exception 'Online payment details are set by the payment service only';
    end if;
    if new.hold_status is distinct from old.hold_status
       or new.hold_note is distinct from old.hold_note
       or new.hold_requested_at is distinct from old.hold_requested_at
       or new.hold_resolved_at is distinct from old.hold_resolved_at then
      raise exception 'Use the Hold buttons to change a job''s hold';
    end if;

    -- Claiming an unclaimed app request is the only way reseller_id changes.
    if new.reseller_id is distinct from old.reseller_id then
      if old.reseller_id is not null then
        raise exception 'Another reseller has already accepted this job';
      end if;
      if new.reseller_id is distinct from uid or "current_role"() <> 'reseller'::user_role or old.status <> 'pending' then
        raise exception 'You cannot accept this job';
      end if;
    end if;

    acting_reseller := uid is not distinct from new.reseller_id;
    acting_client := uid is not distinct from old.client_id and not acting_reseller;
    acting_technician := uid is not distinct from old.technician_id and not acting_reseller;

    if (new.payment_status is distinct from old.payment_status or new.paid_at is distinct from old.paid_at) then
      if not acting_reseller then
        raise exception 'Only the reseller can record a payment';
      end if;
      if new.status <> 'resolved' then
        raise exception 'A job can only be paid once it is complete';
      end if;
    end if;

    if new.payment_method is distinct from old.payment_method and not (acting_reseller or acting_client) then
      raise exception 'You cannot change how this job is paid';
    end if;

    if new.quoted_price is distinct from old.quoted_price then
      if not acting_reseller then
        raise exception 'Only the reseller can change the price';
      end if;
      if old.payment_status = 'paid' then
        raise exception 'This job is already paid, so its price cannot change';
      end if;
      if new.origin = 'app' and old.status <> 'pending' then
        raise exception 'The customer has already been quoted - the price can no longer change';
      end if;
    end if;

    if new.technician_id is distinct from old.technician_id then
      if not acting_reseller then
        raise exception 'Only the reseller can choose the technician';
      end if;
      if new.technician_id is null or new.status <> 'assigned' then
        raise exception 'Offer the job to a technician to change who does it';
      end if;
    end if;

    if new.status is distinct from old.status then
      if acting_reseller then
        allowed :=
          (old.status = 'pending' and new.status = 'quoted' and new.origin = 'app')
          or (new.status = 'assigned' and new.technician_id is not null
              and (old.status = 'approved' or (old.status = 'pending' and new.origin = 'reseller')))
          or (new.status = 'cancelled' and old.status in ('pending', 'quoted', 'approved', 'assigned', 'in_progress'));
      elsif acting_client then
        allowed :=
          (old.status = 'quoted' and new.status in ('approved', 'cancelled'))
          or (old.status in ('pending', 'approved') and new.status = 'cancelled');
      elsif acting_technician then
        allowed := old.status = 'in_progress' and new.status = 'resolved';
      else
        allowed := false;
      end if;

      if not allowed then
        raise exception 'This job cannot move from % to %', old.status, new.status;
      end if;

      if new.status = 'resolved' and old.hold_status = 'on_hold' then
        raise exception 'This job is on hold - resume it before marking it complete';
      end if;
    end if;
  end if;

  -- Applies to every path: a finished or cancelled job has no hold left to
  -- answer, so the reseller isn't asked about it any more.
  if new.status in ('resolved', 'cancelled') and new.hold_status <> 'none' then
    new.hold_status := 'none';
    new.hold_resolved_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists service_requests_guard_insert on service_requests;
create trigger service_requests_guard_insert
  before insert on service_requests
  for each row execute function service_requests_guard_insert();

drop trigger if exists service_requests_guard_update on service_requests;
create trigger service_requests_guard_update
  before update on service_requests
  for each row execute function service_requests_guard_update();

-- 3. Claim an incoming request ------------------------------------------------

create or replace function claim_service_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req service_requests%rowtype;
begin
  if "current_role"() <> 'reseller'::user_role then
    raise exception 'Only resellers can accept requests';
  end if;

  select * into req from service_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if req.reseller_id = auth.uid() then
    return;
  end if;
  if req.reseller_id is not null then
    raise exception 'Another reseller has already accepted this job';
  end if;
  if req.status <> 'pending' or req.origin <> 'app' then
    raise exception 'This request is no longer open';
  end if;

  update service_requests set reseller_id = auth.uid() where id = p_request_id;
end;
$$;

-- 4. Withdraw an unanswered job offer -----------------------------------------

create or replace function withdraw_job_offer(p_request_id uuid)
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
  if req.reseller_id is distinct from auth.uid() and not is_admin() then
    raise exception 'This is not your job';
  end if;
  if req.status <> 'assigned' then
    raise exception 'The technician has already answered this offer';
  end if;

  -- Same hand-back as a technician rejecting it (technician_respond_to_job).
  update service_requests
  set technician_id = null,
      status = case when req.origin = 'reseller' then 'pending'::request_status else 'approved'::request_status end
  where id = p_request_id;
end;
$$;

revoke all on function claim_service_request(uuid) from public;
revoke all on function withdraw_job_offer(uuid) from public;
grant execute on function claim_service_request(uuid) to authenticated;
grant execute on function withdraw_job_offer(uuid) to authenticated;

-- 5. Holds ----------------------------------------------------------------------

create or replace function respond_to_job_hold(p_request_id uuid, p_approve boolean)
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
  if req.reseller_id is distinct from auth.uid() then
    raise exception 'This is not your job';
  end if;
  if req.status <> 'in_progress' then
    raise exception 'This job is no longer in progress';
  end if;
  if req.hold_status <> 'requested' then
    raise exception 'There is no hold request waiting on this job';
  end if;

  update service_requests
  set hold_status = case when p_approve then 'on_hold' else 'none' end,
      hold_resolved_at = now()
  where id = p_request_id;
end;
$$;

create or replace function reopen_completed_job(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req service_requests%rowtype;
  ev record;
begin
  select * into req from service_requests where id = p_request_id for update;
  if not found then
    raise exception 'Job not found';
  end if;
  if auth.uid() is distinct from req.technician_id
     and auth.uid() is distinct from req.reseller_id
     and not is_admin() then
    raise exception 'You cannot change this job';
  end if;
  if req.status <> 'resolved' then
    raise exception 'This job is not marked complete';
  end if;
  if req.payment_status = 'paid' then
    raise exception 'This job is already paid, so it cannot be reopened';
  end if;

  for ev in
    select id, user_id, points from reward_point_events
    where source_id = p_request_id
      and source_type in ('service_request', 'service_request_technician', 'service_request_client', 'service_request_reseller')
  loop
    update profiles set reward_points = greatest(0, reward_points - ev.points) where id = ev.user_id;
    delete from reward_point_events where id = ev.id;
  end loop;

  update job_cards set completed_at = null where service_request_id = p_request_id;
  update service_requests set status = 'in_progress', hold_status = 'none' where id = p_request_id;
end;
$$;

revoke all on function respond_to_job_hold(uuid, boolean) from public;
revoke all on function reopen_completed_job(uuid) from public;
grant execute on function respond_to_job_hold(uuid, boolean) to authenticated;
grant execute on function reopen_completed_job(uuid) to authenticated;

-- Clear holds left dangling on jobs that were finished or cancelled before
-- this migration.
update service_requests
set hold_status = 'none', hold_resolved_at = now()
where status <> 'in_progress' and hold_status <> 'none';

-- 6. Reward points ----------------------------------------------------------------

create or replace function award_reward_points_for_service_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    if new.technician_id is not null then
      insert into reward_point_events (user_id, points, reason, source_type, source_id)
      values (new.technician_id, 1, 'Completed a service request', 'service_request_technician', new.id);
      update profiles set reward_points = reward_points + 1 where id = new.technician_id;
    end if;

    -- A reseller's own walk-in job stores the reseller as client_id - they
    -- get the reseller point below, not a second "client" one.
    if new.client_id is not null and new.client_id is distinct from new.reseller_id then
      insert into reward_point_events (user_id, points, reason, source_type, source_id)
      values (new.client_id, 1, 'Your service request was completed', 'service_request_client', new.id);
      update profiles set reward_points = reward_points + 1 where id = new.client_id;
    end if;

    if new.reseller_id is not null then
      insert into reward_point_events (user_id, points, reason, source_type, source_id)
      values (new.reseller_id, 1, 'Facilitated a completed service request', 'service_request_reseller', new.id);
      update profiles set reward_points = reward_points + 1 where id = new.reseller_id;
    end if;
  end if;
  return new;
end;
$$;

with duplicates as (
  delete from reward_point_events e
  using service_requests sr
  where e.source_type = 'service_request_client'
    and e.source_id = sr.id
    and sr.client_id = sr.reseller_id
  returning e.user_id, e.points
)
update profiles p
set reward_points = greatest(0, p.reward_points - d.total)
from (select user_id, sum(points) as total from duplicates group by user_id) d
where p.id = d.user_id;
