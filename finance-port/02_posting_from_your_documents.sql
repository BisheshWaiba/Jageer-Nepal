-- =====================================================================
-- OPTIONAL: posting your own documents into the finance module
--
-- Run 01_finance_schema.sql first. Nothing here is required - the module
-- works fully with hand-entered bills and payments. Use this when your
-- ERP has documents of its own (a job, a work order, a sales order) that
-- should show up in the books automatically.
--
-- These are Jageer's real triggers with its table names replaced by
-- <your_document>. They are included because the *pattern* is the part
-- worth copying, and getting it wrong produces double-counted money.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The pattern, in four rules
-- ---------------------------------------------------------------------
-- 1. Every posted row carries (source_type, source_id): a constant
--    naming the kind of document, and the document's id. Both unique
--    indexes in 01 exist for this.
--
-- 2. Never plain-insert. Always
--       insert ... on conflict (source_type, source_id)
--         where source_type is not null and source_id is not null
--         do update set ...
--    so re-running the trigger corrects the posted row instead of
--    posting a second one. Triggers re-run far more often than you
--    expect.
--
-- 3. When the document stops qualifying - cancelled, unpaid again, its
--    party removed - DELETE the posted row. An `if qualifies then upsert`
--    with no else leaves stale money in the books forever. Every branch
--    that does not post must delete.
--
-- 4. Post the ledger entry OR the cash row, never both. A document with
--    a known party books against that party's ledger; one without a
--    party (a walk-in) books a business_transactions row that the
--    balance rules treat as settled on the spot. Posting both counts the
--    same money twice.
--
-- And one Postgres trap that bit this code in production: inside these
-- functions, `col = auth.uid()` is NULL - not false - when col is null,
-- so `if not (a or b)` never fires and the guard silently passes. Wrap
-- every nullable comparison in a permission check with coalesce(..., false).

-- ---------------------------------------------------------------------
-- A. Completed work becomes a receivable
-- ---------------------------------------------------------------------
-- "This job is finished and cost 8,000" -> the customer now owes 8,000.
-- Only on completion: a job still in progress is not yet a debt.
create or replace function public.post_document_receivable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  amount numeric;
begin
  -- Replace with however your document knows its value (a quoted price,
  -- the sum of its lines, a job card total).
  amount := new.total_amount;

  if new.customer_id is null or amount is null or amount <= 0 or new.status <> 'completed' then
    delete from customer_ledger_entries
     where source_type = 'your_document' and source_id = new.id;
    return new;
  end if;

  insert into customer_ledger_entries
    (customer_id, owner_id, entry_type, amount, note, source, source_type, source_id)
  values
    (new.customer_id, new.owner_id, 'debit', amount, new.title, 'booking', 'your_document', new.id)
  on conflict (source_type, source_id) where source_type is not null and source_id is not null
  do update set amount = excluded.amount, customer_id = excluded.customer_id, note = excluded.note;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- B. Money actually collected against that document
-- ---------------------------------------------------------------------
-- Handles part payment: the books show what has really been received,
-- and the difference against A is what is still due. Note how the two
-- sides of rule 4 appear as the if/else at the bottom.
create or replace function public.post_document_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  document_total numeric;
  booked         numeric;
begin
  document_total := new.total_amount;
  booked := case
    when new.payment_status = 'paid'    then document_total
    -- Never book more than the document is worth, even if someone typed
    -- a larger amount_paid.
    when new.payment_status = 'partial' then least(coalesce(new.amount_paid, 0),
                                                   coalesce(document_total, coalesce(new.amount_paid, 0)))
    else 0
  end;

  if booked is null or booked <= 0 or new.owner_id is null then
    -- Nothing received, or nothing to receive: clear whatever an earlier
    -- state left behind.
    delete from customer_ledger_entries
     where source_type = 'your_document_payment' and source_id = new.id;
    delete from business_transactions
     where source_type = 'your_document_payment' and source_id = new.id;
    return new;
  end if;

  if new.customer_id is not null then
    -- Known party: credit their ledger, and make sure the walk-in row
    -- from a previous state is gone.
    delete from business_transactions
     where source_type = 'your_document_payment' and source_id = new.id;
    insert into customer_ledger_entries
      (customer_id, owner_id, entry_type, amount, note, source, source_type, source_id)
    values
      (new.customer_id, new.owner_id, 'credit', booked, new.title, 'booking',
       'your_document_payment', new.id)
    on conflict (source_type, source_id) where source_type is not null and source_id is not null
    do update set amount = excluded.amount, customer_id = excluded.customer_id;
  else
    -- Walk-in: no ledger to settle, so this is a cash sale.
    delete from customer_ledger_entries
     where source_type = 'your_document_payment' and source_id = new.id;
    insert into business_transactions
      (owner_id, type, amount, note, party_name, source_type, source_id)
    values
      (new.owner_id, 'sale', booked, new.title, new.customer_name,
       'your_document_payment', new.id)
    on conflict (source_type, source_id) where source_type is not null and source_id is not null
    do update set amount = excluded.amount;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- C. An order delivered posts both sides of the trade
-- ---------------------------------------------------------------------
-- Marketplace shape: one delivered order is a purchase in the buyer's
-- books and a sale in the seller's, itemised the same way a hand-entered
-- bill is. Skip this whole function if your ERP has one set of books.
--
--   if not (OLD.status is distinct from 'delivered' and NEW.status = 'delivered') then
--     return NEW;                      -- only on the transition, once
--   end if;
--
--   select coalesce(jsonb_agg(jsonb_build_object(
--            'description', coalesce(p.name, 'Item'),
--            'qty',         oi.quantity,
--            'rate',        oi.unit_price,
--            'amount',      oi.quantity * oi.unit_price)), '[]'::jsonb)
--     into item_rows
--     from order_items oi left join products p on p.id = oi.product_id
--    where oi.order_id = NEW.id;
--
--   -- buyer's books: a purchase, source_type 'order'
--   -- seller's books: a sale,   source_type 'order_sale'
--   -- (two source_type values, because one order id posts two rows and
--   --  the unique index is on the pair)

-- ---------------------------------------------------------------------
-- Wiring
-- ---------------------------------------------------------------------
-- create trigger your_document_post_receivable
-- after insert or update on public.your_document
-- for each row execute function public.post_document_receivable();
--
-- create trigger your_document_post_payment
-- after insert or update on public.your_document
-- for each row execute function public.post_document_payment();
--
-- Posted rows land with source = 'booking', which the RLS policies in 01
-- make read-only to the owner. That is intended: the document is the
-- source of truth, the ledger entry is its shadow.
