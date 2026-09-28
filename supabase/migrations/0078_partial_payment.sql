-- Money often arrives in pieces: a deposit now, the rest on completion.
-- A job can now be partly paid, carrying how much has actually come in,
-- and three people can move that figure - the reseller who owns the job,
-- a supervisor on their team, and the technician who did the work.
-- Additive only. Safe to run once against the existing schema.

alter table service_requests add column if not exists amount_paid numeric not null default 0;

alter table service_requests drop constraint if exists service_requests_payment_status_check;
alter table service_requests
  add constraint service_requests_payment_status_check
  check (payment_status = any (array['unpaid', 'partial', 'paid']));

-- What the job is worth, so "how much is left" has an answer everywhere.
create or replace function service_request_total(p_request_id uuid, p_quoted numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select service_request_amount(p_request_id, p_quoted);
$$;

grant execute on function service_request_total(uuid, numeric) to authenticated;

-- The ledger follows the money actually received, not the job's price: a
-- part payment books what came in, and the rest appears when it does.
create or replace function sync_service_request_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  job_total numeric;
  booked numeric;
begin
  job_total := service_request_amount(new.id, new.quoted_price);
  booked := case
    when new.payment_status = 'paid' then job_total
    when new.payment_status = 'partial' then least(coalesce(new.amount_paid, 0), coalesce(job_total, coalesce(new.amount_paid, 0)))
    else 0
  end;

  if booked is null or booked <= 0 or new.reseller_id is null then
    -- Nothing received (or nothing to receive): drop any entry a previous
    -- state had left behind.
    delete from customer_ledger_entries where source_type = 'service_request_payment' and source_id = new.id;
    delete from business_transactions where source_type = 'service_request_payment' and source_id = new.id;
    return new;
  end if;

  if new.customer_id is not null then
    delete from business_transactions where source_type = 'service_request_payment' and source_id = new.id;
    insert into customer_ledger_entries (customer_id, owner_id, entry_type, amount, note, source, source_type, source_id)
    values (new.customer_id, new.reseller_id, 'credit', booked, new.issue_type, 'booking', 'service_request_payment', new.id)
    on conflict (source_type, source_id) where source_type is not null and source_id is not null
    do update set amount = excluded.amount, customer_id = excluded.customer_id;
  else
    delete from customer_ledger_entries where source_type = 'service_request_payment' and source_id = new.id;
    insert into business_transactions (owner_id, type, amount, note, party_name, source_type, source_id)
    values (new.reseller_id, 'sale', booked, new.issue_type, new.customer_name, 'service_request_payment', new.id)
    on conflict (source_type, source_id) where source_type is not null and source_id is not null
    do update set amount = excluded.amount;
  end if;

  return new;
end;
$$;

-- One way in for all three roles, so the rules live in one place: the
-- reseller who owns the job, a supervisor on their team, and the
-- technician who did it. Everyone else is refused.
create or replace function set_job_payment(p_request_id uuid, p_status text, p_amount_paid numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req service_requests%rowtype;
  job_total numeric;
  paid numeric;
begin
  if p_status not in ('unpaid', 'partial', 'paid') then
    raise exception 'Unknown payment status';
  end if;

  select * into req from service_requests where id = p_request_id for update;
  if not found then
    raise exception 'Job not found';
  end if;

  -- coalesce, not a bare comparison: a job with no technician yet makes
  -- `technician_id = auth.uid()` NULL, and `not (false or NULL)` is NULL,
  -- which is not true - so the check would quietly pass and let anyone
  -- signed in change the payment.
  if not (
    coalesce(req.reseller_id = auth.uid(), false)
    or coalesce(req.technician_id = auth.uid(), false)
    or (req.reseller_id is not null and is_supervisor_for(req.reseller_id))
    or is_admin()
  ) then
    raise exception 'Only the reseller, a supervisor or the technician on this job can change its payment';
  end if;

  job_total := service_request_amount(p_request_id, req.quoted_price);

  if p_status = 'paid' then
    paid := coalesce(job_total, coalesce(p_amount_paid, 0));
  elsif p_status = 'partial' then
    paid := coalesce(p_amount_paid, 0);
    if paid <= 0 then
      raise exception 'Enter how much has been received';
    end if;
    if job_total is not null and paid >= job_total then
      -- Received the lot: that is simply paid, whatever the button said.
      p_status := 'paid';
      paid := job_total;
    end if;
  else
    paid := 0;
  end if;

  update service_requests
  set payment_status = p_status,
      amount_paid = paid
  where id = p_request_id;
end;
$$;

grant execute on function set_job_payment(uuid, text, numeric) to authenticated;
