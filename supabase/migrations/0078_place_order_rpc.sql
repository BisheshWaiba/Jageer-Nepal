-- Checkout used to insert the order, then each order_item one at a time
-- from the app. If an item insert failed, the order already existed with
-- missing lines, and retrying checkout created a second order.
-- place_order() does both in one transaction - any failure rolls the whole
-- order back - and prices each line from the products table itself rather
-- than trusting the amounts the app sends.
--
-- SECURITY INVOKER on purpose: the caller's own RLS policies on orders and
-- order_items still decide whether they may place it.

create or replace function place_order(p_seller_id uuid, p_items jsonb, p_shipping jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order_id uuid;
  v_total numeric := 0;
  v_fee numeric;
  v_item jsonb;
  v_price numeric;
  v_qty integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Each item needs a quantity of at least 1';
    end if;
    select price into v_price
    from products
    where id = (v_item->>'product_id')::uuid and seller_id = p_seller_id;
    if v_price is null then
      raise exception 'A product in your cart is no longer available from this seller';
    end if;
    v_total := v_total + v_price * v_qty;
  end loop;

  -- Same 7.5% platform fee the app showed before.
  v_fee := round(v_total * 0.075);

  insert into orders (buyer_id, seller_id, total_amount, platform_fee, seller_payout, payment_method, shipping_address, status)
  values (auth.uid(), p_seller_id, v_total, v_fee, v_total - v_fee, 'cash_on_delivery', p_shipping, 'pending')
  returning id into v_order_id;

  insert into order_items (order_id, product_id, quantity, unit_price)
  select v_order_id, p.id, (e->>'quantity')::integer, p.price
  from jsonb_array_elements(p_items) e
  join products p on p.id = (e->>'product_id')::uuid and p.seller_id = p_seller_id;

  return v_order_id;
end;
$$;

revoke all on function place_order(uuid, jsonb, jsonb) from public;
grant execute on function place_order(uuid, jsonb, jsonb) to authenticated;
