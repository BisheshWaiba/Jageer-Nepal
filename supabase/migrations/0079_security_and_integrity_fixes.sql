-- Fixes from the security / data-integrity review. Each section is
-- independent; run the whole file once.

-- 1. Request photos and chalans ------------------------------------------------
-- request_photos_select (0005) let ANY technician, reseller or wholesaler
-- account read every file in the bucket - and those roles are self-chosen
-- at sign-up, so anyone could register and download photos of customers'
-- homes and their delivery slips. Now a file is readable by the person who
-- uploaded it, an admin, or someone who can actually see a service request
-- that uses it (as a photo or a chalan): its customer, its reseller, its
-- technician, or - for an unclaimed incoming app request - any reseller
-- deciding whether to take it.

create or replace function can_read_request_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from service_requests sr
    where (p_name = any (sr.photo_urls) or p_name = any (sr.chalan_urls))
      and (
        sr.client_id = auth.uid()
        or sr.reseller_id = auth.uid()
        or sr.technician_id = auth.uid()
        or (
          sr.status = 'pending'
          and sr.origin = 'app'
          and sr.reseller_id is null
          and "current_role"() = 'reseller'::user_role
        )
      )
  )
$$;

revoke all on function can_read_request_file(text) from public;
grant execute on function can_read_request_file(text) to authenticated;

drop policy if exists request_photos_select on storage.objects;
create policy request_photos_select on storage.objects
  for select using (
    bucket_id = 'request-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or public.can_read_request_file(name)
    )
  );

-- 2. Profiles: role, verification, active flag, reward points --------------------
-- Nothing stopped a user from updating these on their own profile row (the
-- profile screen writes that row directly), so an account could make itself
-- an admin, mark itself verified, or set its own reward points - and the
-- role chosen at sign-up is sent by the app, so a crafted sign-up could ask
-- for 'admin' outright.
--
-- Direct API writes (current_user = 'authenticated') by a non-admin can no
-- longer change these columns. Server-side code - SECURITY DEFINER
-- functions like the reward-point triggers, which run as the function
-- owner - is unaffected, as are admins (app/(admin)/users.tsx).
-- A new profile can never start as an admin, however it was created: make
-- someone an admin afterwards (an existing admin in the app, or an UPDATE in
-- the SQL editor).

create or replace function profiles_guard_privileged_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.role = 'admin'::user_role and not is_admin() then
      new.role := 'client'::user_role;
    end if;
    if current_user in ('authenticated', 'anon') and not is_admin() then
      new.reward_points := 0;
      new.verification_status := 'unverified';
      new.verification_notes := null;
    end if;
    return new;
  end if;

  if current_user in ('authenticated', 'anon') and not is_admin() then
    if new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
       or new.verification_status is distinct from old.verification_status
       or new.verification_notes is distinct from old.verification_notes
       or new.reward_points is distinct from old.reward_points then
      raise exception 'Only an admin can change role, verification, active status or reward points';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged_columns on profiles;
create trigger profiles_guard_privileged_columns
  before insert or update on profiles
  for each row execute function profiles_guard_privileged_columns();

-- 3. Orders: totals, status and stock -------------------------------------------
-- A delivered order is booked into both sides' Finance from its stored
-- total_amount / seller_payout, but nothing stopped the buyer from editing
-- those on their own order row, or inserting an order (or extra order_items)
-- directly with any amount. Stock was also decremented from the app's cached
-- copy of each product, one row at a time, so two confirms could lose an
-- update and a failure part-way left stock reduced on an unconfirmed order.
--
-- Now every order change goes through a server function:
--   place_order   - checkout; prices from products, checks stock and the
--                   listing's minimum order quantity
--   advance_order - seller: pending -> confirmed (takes the stock, refusing
--                   to oversell) -> delivered
--   cancel_order  - seller while pending/confirmed, buyer while pending;
--                   gives the stock back if it had been taken
-- and a guard refuses direct API writes to money/party/status columns and
-- to order_items. SECURITY DEFINER functions run as their owner, so the
-- guard doesn't apply to them - they check permission themselves.

create or replace function place_order(p_seller_id uuid, p_items jsonb, p_shipping jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer uuid := auth.uid();
  v_order_id uuid;
  v_total numeric := 0;
  v_fee numeric;
  v_item jsonb;
  v_product products%rowtype;
  v_qty integer;
begin
  if v_buyer is null then
    raise exception 'Please sign in to place an order';
  end if;
  if p_seller_id = v_buyer then
    raise exception 'You cannot order from yourself';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Each item needs a quantity of at least 1';
    end if;
    select * into v_product
    from products
    where id = (v_item->>'product_id')::uuid and seller_id = p_seller_id;
    if not found then
      raise exception 'A product in your cart is no longer available from this seller';
    end if;
    if v_qty < coalesce(v_product.min_order_qty, 1) then
      raise exception '% needs at least % units per order', v_product.name, v_product.min_order_qty;
    end if;
    if v_qty > v_product.stock_level then
      raise exception 'Only % of % left in stock', v_product.stock_level, v_product.name;
    end if;
    v_total := v_total + v_product.price * v_qty;
  end loop;

  -- Same 7.5% platform fee the app has always shown.
  v_fee := round(v_total * 0.075);

  insert into orders (buyer_id, seller_id, total_amount, platform_fee, seller_payout, payment_method, shipping_address, status)
  values (v_buyer, p_seller_id, v_total, v_fee, v_total - v_fee, 'cash_on_delivery', p_shipping, 'pending')
  returning id into v_order_id;

  insert into order_items (order_id, product_id, quantity, unit_price)
  select v_order_id, p.id, (e->>'quantity')::integer, p.price
  from jsonb_array_elements(p_items) e
  join products p on p.id = (e->>'product_id')::uuid and p.seller_id = p_seller_id;

  return v_order_id;
end;
$$;

create or replace function advance_order(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o orders%rowtype;
  item record;
  v_stock integer;
  v_name text;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if o.seller_id is distinct from auth.uid() and not is_admin() then
    raise exception 'Only the seller can update this order';
  end if;

  if o.status = 'pending' then
    for item in select product_id, quantity from order_items where order_id = o.id loop
      select stock_level, name into v_stock, v_name from products where id = item.product_id for update;
      if v_stock is null then
        continue;
      end if;
      if v_stock < item.quantity then
        raise exception 'Only % of % left in stock - this order needs %', v_stock, v_name, item.quantity;
      end if;
      update products set stock_level = stock_level - item.quantity where id = item.product_id;
    end loop;
    update orders set status = 'confirmed' where id = o.id;
    return 'confirmed';
  elsif o.status in ('confirmed', 'shipped') then
    update orders set status = 'delivered' where id = o.id;
    return 'delivered';
  end if;

  raise exception 'This order is already %', o.status;
end;
$$;

create or replace function cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o orders%rowtype;
  item record;
  is_seller boolean;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;
  is_seller := o.seller_id = auth.uid() or is_admin();

  if o.status = 'pending' then
    if not is_seller and o.buyer_id is distinct from auth.uid() then
      raise exception 'You cannot cancel this order';
    end if;
  elsif o.status in ('confirmed', 'shipped') then
    if not is_seller then
      raise exception 'The seller has already confirmed this order - ask them to cancel it';
    end if;
    -- Confirming took the stock; give it back.
    for item in select product_id, quantity from order_items where order_id = o.id loop
      update products set stock_level = stock_level + item.quantity where id = item.product_id;
    end loop;
  else
    raise exception 'A % order cannot be cancelled', o.status;
  end if;

  update orders set status = 'cancelled' where id = o.id;
end;
$$;

revoke all on function place_order(uuid, jsonb, jsonb) from public;
revoke all on function advance_order(uuid) from public;
revoke all on function cancel_order(uuid) from public;
grant execute on function place_order(uuid, jsonb, jsonb) to authenticated;
grant execute on function advance_order(uuid) to authenticated;
grant execute on function cancel_order(uuid) to authenticated;

create or replace function orders_guard_direct_writes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') or is_admin() then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'order_items' then
    raise exception 'Order lines can only be set at checkout';
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Orders can only be placed through checkout';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Orders cannot be deleted - cancel them instead';
  end if;

  if new.buyer_id is distinct from old.buyer_id
     or new.seller_id is distinct from old.seller_id
     or new.total_amount is distinct from old.total_amount
     or new.platform_fee is distinct from old.platform_fee
     or new.seller_payout is distinct from old.seller_payout
     or new.payment_method is distinct from old.payment_method
     or new.status is distinct from old.status then
    raise exception 'Use the order buttons to change an order';
  end if;
  if new.shipping_address is distinct from old.shipping_address
     and not (old.buyer_id = auth.uid() and old.status = 'pending') then
    raise exception 'Only the buyer can change the delivery address, and only before the order is confirmed';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_guard_direct_writes on orders;
create trigger orders_guard_direct_writes
  before insert or update or delete on orders
  for each row execute function orders_guard_direct_writes();

drop trigger if exists order_items_guard_direct_writes on order_items;
create trigger order_items_guard_direct_writes
  before insert or update or delete on order_items
  for each row execute function orders_guard_direct_writes();

-- 4. Fonepay: remember every QR issued for a job --------------------------------
-- Each "Pay online" / "Show QR" created a new PRN and overwrote fonepay_prn,
-- and the status check only asked Fonepay about that newest one - so a
-- customer who paid a QR shown earlier (say, on the reseller's phone) was
-- never marked paid, and could be asked to pay again. Every PRN is now kept,
-- and the status check asks about each of them (newest first).
alter table service_requests add column if not exists fonepay_prns text[] not null default '{}';

update service_requests
set fonepay_prns = array[fonepay_prn]
where fonepay_prn is not null and cardinality(fonepay_prns) = 0;

-- 5. Messages on pending requests ------------------------------------------------
-- 0007 let ANY reseller or wholesaler read and post on every pending request
-- - including one another reseller had already claimed (a request stays
-- 'pending' until it's quoted), so a competitor could read the thread and
-- message that reseller's customer. Now only resellers see the chat of a
-- request that is still unclaimed; once claimed it belongs to the customer,
-- that reseller and the technician.

drop policy if exists messages_select on messages;
create policy messages_select on messages
  for select using (
    sender_id = auth.uid()
    or is_admin()
    or (
      subject_type = 'service_request' and exists (
        select 1 from service_requests sr
        where sr.id = messages.subject_id
          and (
            sr.client_id = auth.uid()
            or sr.technician_id = auth.uid()
            or sr.reseller_id = auth.uid()
            or (sr.status = 'pending' and sr.reseller_id is null and public."current_role"() = 'reseller'::user_role)
          )
      )
    )
    or (
      subject_type = 'order' and exists (
        select 1 from orders o
        where o.id = messages.subject_id
          and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
      )
    )
  );

drop policy if exists messages_insert on messages;
create policy messages_insert on messages
  for insert with check (
    sender_id = auth.uid()
    and (
      (
        subject_type = 'service_request' and exists (
          select 1 from service_requests sr
          where sr.id = messages.subject_id
            and (
              sr.client_id = auth.uid()
              or sr.technician_id = auth.uid()
              or sr.reseller_id = auth.uid()
              or (sr.status = 'pending' and sr.reseller_id is null and public."current_role"() = 'reseller'::user_role)
            )
        )
      )
      or (
        subject_type = 'order' and exists (
          select 1 from orders o
          where o.id = messages.subject_id
            and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
        )
      )
    )
  );

-- 6. Technician employment consent --------------------------------------------------
-- 0070's guard only checked a pending -> accepted change, so consent could
-- be skipped: a rejected application could be set straight to 'accepted',
-- or the side that started it could first rewrite initiated_by and then
-- "accept" its own request. Now, for non-admins:
--   - who's on the row (technician, reseller) and who started it never change
--   - only the other side can accept or decline a pending request
--   - either side can withdraw a pending one or end an accepted one
--   - declined and ended rows stay closed (start a new request instead)

create or replace function technician_employment_guard_accept() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  other_party uuid;
begin
  if is_admin() then
    return new;
  end if;

  if new.technician_id is distinct from old.technician_id
     or new.reseller_id is distinct from old.reseller_id
     or new.initiated_by is distinct from old.initiated_by then
    raise exception 'The people on an employment request cannot be changed';
  end if;

  if new.status is distinct from old.status then
    other_party := case when old.initiated_by = 'reseller' then old.technician_id else old.reseller_id end;

    if old.status = 'pending' and new.status in ('accepted', 'rejected') then
      if auth.uid() is distinct from other_party then
        raise exception 'Only the other side can accept or decline this request';
      end if;
    elsif old.status = 'pending' and new.status = 'ended' then
      null; -- either side can withdraw it
    elsif old.status = 'accepted' and new.status = 'ended' then
      null; -- either side can end it
    else
      raise exception 'An employment request cannot go from % to %', old.status, new.status;
    end if;
  end if;

  return new;
end;
$$;

-- 7. Employee emails ----------------------------------------------------------------
-- my_employee_emails (0074) returned the sign-in email of every technician
-- with a pending row - and a reseller can create a pending invite to any
-- technician, so invite-then-read harvested anyone's email. Now it's only
-- technicians who actually work for this reseller, or who applied to them
-- themselves (their own request is their consent to be contacted).

create or replace function my_employee_emails()
returns table (id uuid, email text)
language sql
security definer
set search_path = public
as $$
  select distinct p.id, u.email::text
  from technician_employment te
  join profiles p on p.id = te.technician_id
  join auth.users u on u.id = p.id
  where te.reseller_id = auth.uid()
    and (te.status = 'accepted' or (te.status = 'pending' and te.initiated_by = 'technician'));
$$;

-- 8. Wholesaler product photos -----------------------------------------------------
-- The wholesaler "Create product" form uploads its photo to catalog-images,
-- but 0020 only let admins write there, so every upload failed. Wholesalers
-- may now add (not replace or delete) files under submissions/<their id>/.

drop policy if exists catalog_images_insert_wholesaler_submission on storage.objects;
create policy catalog_images_insert_wholesaler_submission on storage.objects
  for insert with check (
    bucket_id = 'catalog-images'
    and (storage.foldername(name))[1] = 'submissions'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public."current_role"() = 'wholesaler'::user_role
  );

-- 9. Technicians on duty for another reseller --------------------------------------
-- The technician picker hides another reseller's employees during their
-- declared work hours, but it read technician_employment directly - and RLS
-- only lets a reseller see their own rows - so nobody else's employees were
-- ever hidden. This returns just the technician and their hours (not who
-- employs them) for every accepted employment that isn't the caller's.

create or replace function technicians_employed_elsewhere()
returns table (technician_id uuid, work_start_time time, work_end_time time)
language sql
stable
security definer
set search_path = public
as $$
  select te.technician_id, te.work_start_time, te.work_end_time
  from technician_employment te
  where te.status = 'accepted'
    and te.reseller_id is distinct from auth.uid()
    and "current_role"() = 'reseller'::user_role;
$$;

revoke all on function technicians_employed_elsewhere() from public;
grant execute on function technicians_employed_elsewhere() to authenticated;

-- 10. Daily AI usage limit -----------------------------------------------------------
-- The AI Edge Functions only checked that the caller was signed in, and
-- sign-up is open, so any account could spend the shared Gemini quota
-- without limit. Each call now counts against a per-user daily allowance
-- (see supabase/functions/_shared/limits.ts). Calling this directly only
-- ever raises the caller's own count.

create table if not exists ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  calls integer not null default 0,
  primary key (user_id, day)
);

alter table ai_usage enable row level security;
-- No policies: only bump_ai_usage (SECURITY DEFINER) touches this table.

create or replace function bump_ai_usage(p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_calls integer;
  v_day date := (now() at time zone 'Asia/Kathmandu')::date;
begin
  if auth.uid() is null then
    return false;
  end if;
  insert into ai_usage (user_id, day, calls)
  values (auth.uid(), v_day, 1)
  on conflict (user_id, day) do update set calls = ai_usage.calls + 1
  returning calls into v_calls;
  return v_calls <= p_limit;
end;
$$;

revoke all on function bump_ai_usage(integer) from public;
grant execute on function bump_ai_usage(integer) to authenticated;
