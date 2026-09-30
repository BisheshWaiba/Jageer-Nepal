-- =====================================================================
-- Finance module - complete install script
-- Extracted from the live Jageer Nepal database (Supabase/Postgres),
-- 2026-09-30. Consolidates migrations 0006..0078 into one file.
--
-- Run this on a FRESH Supabase project (SQL editor, or psql against the
-- pooler). It creates its own books; it shares no data with Jageer.
--
-- Read the "ADAPTER" section first - it is the only part you normally
-- change. Everything below it is the Jageer schema verbatim, because the
-- accounting rules live in these constraints and triggers, not in the UI.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- ADAPTER - wire the module into YOUR project
-- ---------------------------------------------------------------------
-- 1. WHO OWNS A BOOK.
--    Every finance row carries owner_id: the user whose books it is.
--    Below it points at auth.users, which exists in every Supabase
--    project. If you have your own profiles/users table, replace
--    `auth.users(id)` with `public.profiles(id)` in every FK below -
--    nothing else changes.
--
-- 2. WHO IS AN ADMIN.
--    Every table has a second policy letting an admin read and write
--    anyone's books (support, back-office). Point this function at
--    however your project decides that. Returning false everywhere is a
--    perfectly good answer - owners can still see their own books.
create or replace function public.finance_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Jageer's version: select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
  select coalesce((select (raw_app_meta_data ->> 'role') = 'admin' from auth.users where id = auth.uid()), false);
$$;

-- Keeps updated_at honest. (Jageer never wired this onto its finance
-- tables, so its updated_at columns are really "created_at" - fixed here
-- because nothing reads them, so nothing can break.)
create or replace function public.finance_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. PARTIES
-- ---------------------------------------------------------------------
-- One table for customers AND vendors. The same person can buy from you
-- and sell to you; which side they are on is decided per entry by which
-- ledger it lands in, never by a flag on the party. Keeping one table is
-- what lets "Ram" show both "to receive 5,000" and "to pay 2,000".
create table if not exists public.customers (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references auth.users(id),
  name                  text not null,
  phone                 text,
  address               text,
  latitude              double precision,
  longitude             double precision,
  contact_person_name   text,
  contact_person_phone  text,
  -- Set when the row came from a phone-contacts sync; drop if you have no
  -- such sync.
  phone_contact_id      text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists customers_owner_idx on public.customers (owner_id, name);
-- One party per phone number per book: the payment forms look a party up
-- by phone before creating one, and this is what stops the duplicate.
create unique index if not exists customers_owner_phone_idx
  on public.customers (owner_id, phone) where phone is not null and phone <> '';
create unique index if not exists customers_owner_phone_contact_idx
  on public.customers (owner_id, phone_contact_id) where phone_contact_id is not null;

-- ---------------------------------------------------------------------
-- 2. WHERE THE MONEY SITS
-- ---------------------------------------------------------------------
-- Cash is not a row: bank_account_id = null MEANS cash in hand, on every
-- table that has that column. Do not "helpfully" add a Cash account -
-- every balance calculation buckets null as cash.
create table if not exists public.bank_accounts (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users(id),
  name                text not null,
  bank_name           text,
  account_number      text,
  account_holder_name text,
  address             text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists bank_accounts_owner_name_idx
  on public.bank_accounts (owner_id, lower(name));

-- Moving your own money between your own accounts. Never touches sales,
-- purchases or any party ledger, and never changes the combined balance -
-- one account goes down, the other goes up.
create table if not exists public.account_transfers (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id),
  from_account_id uuid references public.bank_accounts(id) on delete set null,
  to_account_id   uuid references public.bank_accounts(id) on delete set null,
  amount          numeric not null check (amount > 0),
  note            text,
  transfer_date   date not null,
  created_at      timestamptz not null default now(),
  constraint account_transfers_different_accounts
    check (from_account_id is distinct from to_account_id)
);

create index if not exists account_transfers_owner_idx
  on public.account_transfers (owner_id, transfer_date);

-- ---------------------------------------------------------------------
-- 3. CLASSIFICATION
-- ---------------------------------------------------------------------
create table if not exists public.expense_categories (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists expense_categories_owner_name_idx
  on public.expense_categories (owner_id, lower(name));

-- Line-item names the owner typed on a bill, remembered so the next bill
-- can offer them. Deliberately separate from any product catalog: a
-- catalog is usually curated and restricted, while billing has to accept
-- "2 metre CAT6 patch cord" the moment someone types it.
create table if not exists public.finance_items (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id),
  name       text not null,
  rate       numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_items_owner_name_idx
  on public.finance_items (owner_id, name);

-- ---------------------------------------------------------------------
-- 4. BILLS AND EXPENSES
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'business_transaction_type') then
    create type public.business_transaction_type as enum ('sale', 'purchase', 'expense');
  end if;
end
$$;

-- A sale or purchase BILL, or an expense.
--
-- The rule that everything else depends on: a sale or purchase does not
-- move money. It books a debt on the party's ledger (see the triggers at
-- the bottom), and the money moves later, as its own payment entry. An
-- expense is the exception - it is paid on the spot, so it is cash out
-- the moment it is recorded.
create table if not exists public.business_transactions (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users(id),
  type                public.business_transaction_type not null,
  -- The grand total actually billed: subtotal - discount + VAT.
  amount              numeric not null check (amount > 0),
  note                text,
  -- Free-text name as written on the bill. customer_id is the real link;
  -- this survives even if the party row is later deleted.
  party_name          text,
  customer_id         uuid references public.customers(id) on delete set null,
  bill_no             text,
  bill_date           date,
  party_address       text,
  vat_pan_no          text,
  -- [{description, qty, rate, amount}, ...]
  items               jsonb not null default '[]'::jsonb,
  discount_amount     numeric not null default 0,
  vat_amount          numeric not null default 0,
  expense_category_id uuid references public.expense_categories(id),
  payment_mode        text not null default 'cash'
                      check (payment_mode in ('cash', 'bank', 'credit')),
  bank_account_id     uuid references public.bank_accounts(id) on delete set null,
  -- Set when another part of the system created this row (an order, a
  -- job). Hand-entered rows leave both null. See "posting from elsewhere"
  -- in 02_job_posting_template.sql.
  source_type         text,
  source_id           uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists business_transactions_owner_idx
  on public.business_transactions (owner_id, type, created_at);
create index if not exists business_transactions_customer_idx
  on public.business_transactions (customer_id, created_at);
-- Load-bearing: this is the conflict target every "post it once, keep it
-- in step afterwards" upsert relies on.
create unique index if not exists business_transactions_source_idx
  on public.business_transactions (source_type, source_id)
  where source_type is not null and source_id is not null;

-- ---------------------------------------------------------------------
-- 5. THE TWO LEDGERS
-- ---------------------------------------------------------------------
-- Two tables, opposite polarity, one party table. Netting them into a
-- single signed balance hides half the story when someone is both a
-- customer and a supplier, so they are kept apart everywhere.
--
--   customer_ledger_entries : debit = they owe you more (a sale)
--                             credit = they paid you (money in)
--   vendor_ledger_entries   : debit = you owe them more (a purchase)
--                             credit = you paid them (money out)
--
-- source = 'manual'  -> typed by a person; editable and deletable.
-- source = 'booking' -> written by a trigger from a bill/job; read-only
--                       to the owner, kept in step by whatever made it.
--                       The RLS policies below enforce exactly that.
create table if not exists public.customer_ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id) on delete cascade,
  owner_id        uuid not null references auth.users(id),
  entry_type      text not null check (entry_type in ('debit', 'credit')),
  amount          numeric not null check (amount > 0),
  note            text,
  source          text not null default 'manual' check (source in ('manual', 'booking')),
  source_type     text,
  source_id       uuid,
  bank_account_id uuid references public.bank_accounts(id) on delete set null,
  -- The day the money moved, as the user gave it. Falls back to
  -- created_at when null - every screen reads `entry_date ?? created_at`.
  entry_date      date,
  receipt_no      text,
  created_at      timestamptz not null default now()
);

create index if not exists customer_ledger_entries_customer_idx
  on public.customer_ledger_entries (customer_id, created_at);
create unique index if not exists customer_ledger_entries_source_idx
  on public.customer_ledger_entries (source_type, source_id)
  where source_type is not null and source_id is not null;

create table if not exists public.vendor_ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  vendor_id       uuid not null references public.customers(id) on delete cascade,
  owner_id        uuid not null references auth.users(id),
  entry_type      text not null check (entry_type in ('debit', 'credit')),
  amount          numeric not null check (amount > 0),
  note            text,
  source          text not null default 'manual' check (source in ('manual', 'booking')),
  source_type     text,
  source_id       uuid,
  bank_account_id uuid references public.bank_accounts(id) on delete set null,
  entry_date      date,
  receipt_no      text,
  created_at      timestamptz not null default now()
);

create index if not exists vendor_ledger_entries_vendor_idx
  on public.vendor_ledger_entries (vendor_id, created_at);
create unique index if not exists vendor_ledger_entries_source_idx
  on public.vendor_ledger_entries (source_type, source_id)
  where source_type is not null and source_id is not null;

-- ---------------------------------------------------------------------
-- 6. STATEMENT IMPORT BOOKKEEPING
-- ---------------------------------------------------------------------
-- One row per statement line already imported, keyed by the bank's own
-- reference code. Re-importing the same file, or a later file whose date
-- range overlaps, then skips what is already in. This is the whole
-- duplicate defence - do not drop it.
create table if not exists public.statement_imports (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id),
  reference_code text not null,
  created_at     timestamptz not null default now(),
  unique (owner_id, reference_code)
);

-- ---------------------------------------------------------------------
-- 7. THE POSTING RULES (triggers)
-- ---------------------------------------------------------------------
-- A sale bill against a saved customer books what they now owe you.
-- Change the bill and the debt follows; delete the bill and the debt
-- goes with it. A bill with no customer_id books nothing - that is the
-- walk-in case, and every balance calculation treats it as cash settled
-- on the spot instead.
create or replace function public.sync_sale_to_customer_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from customer_ledger_entries
     where source_type = 'business_transaction' and source_id = old.id;
    return old;
  end if;

  if new.type = 'sale' and new.customer_id is not null and new.amount > 0 then
    insert into customer_ledger_entries
      (customer_id, owner_id, entry_type, amount, note, source, source_type, source_id, entry_date)
    values
      (new.customer_id, new.owner_id, 'debit', new.amount, new.note, 'booking',
       'business_transaction', new.id, new.bill_date)
    on conflict (source_type, source_id) where source_type is not null and source_id is not null
    do update set amount      = excluded.amount,
                  customer_id = excluded.customer_id,
                  note        = excluded.note,
                  entry_date  = excluded.entry_date;
  else
    -- Type or party changed away from "sale to a saved customer": the
    -- debt this bill used to book is no longer real.
    delete from customer_ledger_entries
     where source_type = 'business_transaction' and source_id = new.id;
  end if;

  return new;
end;
$$;

-- The mirror image, for purchases.
create or replace function public.sync_purchase_credit_to_vendor_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from vendor_ledger_entries
     where source_type = 'business_transaction' and source_id = old.id;
    return old;
  end if;

  if new.type = 'purchase' and new.customer_id is not null and new.amount > 0 then
    insert into vendor_ledger_entries
      (vendor_id, owner_id, entry_type, amount, note, source, source_type, source_id, entry_date)
    values
      (new.customer_id, new.owner_id, 'debit', new.amount, new.note, 'booking',
       'business_transaction', new.id, new.bill_date)
    on conflict (source_type, source_id) where source_type is not null and source_id is not null
    do update set amount     = excluded.amount,
                  vendor_id  = excluded.vendor_id,
                  note       = excluded.note,
                  entry_date = excluded.entry_date;
  else
    delete from vendor_ledger_entries
     where source_type = 'business_transaction' and source_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists business_transactions_sync_customer_ledger on public.business_transactions;
create trigger business_transactions_sync_customer_ledger
after insert or update or delete on public.business_transactions
for each row execute function public.sync_sale_to_customer_ledger();

drop trigger if exists business_transactions_sync_vendor_ledger on public.business_transactions;
create trigger business_transactions_sync_vendor_ledger
after insert or update or delete on public.business_transactions
for each row execute function public.sync_purchase_credit_to_vendor_ledger();

-- updated_at upkeep (see the ADAPTER note).
drop trigger if exists customers_touch on public.customers;
create trigger customers_touch before update on public.customers
for each row execute function public.finance_touch_updated_at();

drop trigger if exists bank_accounts_touch on public.bank_accounts;
create trigger bank_accounts_touch before update on public.bank_accounts
for each row execute function public.finance_touch_updated_at();

drop trigger if exists expense_categories_touch on public.expense_categories;
create trigger expense_categories_touch before update on public.expense_categories
for each row execute function public.finance_touch_updated_at();

drop trigger if exists finance_items_touch on public.finance_items;
create trigger finance_items_touch before update on public.finance_items
for each row execute function public.finance_touch_updated_at();

drop trigger if exists business_transactions_touch on public.business_transactions;
create trigger business_transactions_touch before update on public.business_transactions
for each row execute function public.finance_touch_updated_at();

-- ---------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
-- You see your own books and nobody else's. This is the only thing
-- standing between two tenants' accounts, so enable it on every table
-- even in a single-tenant install.
alter table public.customers               enable row level security;
alter table public.bank_accounts           enable row level security;
alter table public.account_transfers       enable row level security;
alter table public.expense_categories      enable row level security;
alter table public.finance_items           enable row level security;
alter table public.business_transactions   enable row level security;
alter table public.customer_ledger_entries enable row level security;
alter table public.vendor_ledger_entries   enable row level security;
alter table public.statement_imports       enable row level security;

-- Plain owner-owns-everything tables.
do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'bank_accounts', 'account_transfers', 'expense_categories',
    'finance_items', 'business_transactions', 'statement_imports'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_all_owner', t);
    execute format(
      'create policy %I on public.%I for all using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
      t || '_all_owner', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all using (public.finance_is_admin()) with check (public.finance_is_admin())',
      t || '_admin_all', t);
  end loop;
end
$$;

-- The ledgers are stricter: you may read everything in your own books,
-- but only hand-entered rows are yours to change. A row a trigger wrote
-- (source = 'booking') belongs to the bill or job behind it - edit that,
-- and the entry follows. Without this, someone could "fix" a job's
-- payment here and have the next trigger run silently overwrite it.
do $$
declare
  t text;
begin
  foreach t in array array['customer_ledger_entries', 'vendor_ledger_entries']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using (owner_id = auth.uid())',
                   t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert_manual', t);
    execute format($f$create policy %I on public.%I for insert
                      with check (owner_id = auth.uid() and source = 'manual')$f$,
                   t || '_insert_manual', t);

    execute format('drop policy if exists %I on public.%I', t || '_update_manual', t);
    execute format($f$create policy %I on public.%I for update
                      using (owner_id = auth.uid() and source = 'manual')
                      with check (owner_id = auth.uid() and source = 'manual')$f$,
                   t || '_update_manual', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete_manual', t);
    execute format($f$create policy %I on public.%I for delete
                      using (owner_id = auth.uid() and source = 'manual')$f$,
                   t || '_delete_manual', t);

    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all using (public.finance_is_admin()) with check (public.finance_is_admin())',
      t || '_admin_all', t);
  end loop;
end
$$;

commit;

-- =====================================================================
-- Smoke test (optional). Paste into the SQL editor and run as one block.
-- It proves the posting trigger works, then rolls itself back, so it
-- leaves nothing behind. Put a real user id in `book_owner`.
--
-- begin;
-- do $test$
-- declare
--   book_owner uuid := '00000000-0000-0000-0000-000000000000';  -- <- yours
--   party      uuid;
--   bill       uuid;
--   posted     record;
-- begin
--   insert into customers (owner_id, name)
--     values (book_owner, 'Smoke test party') returning id into party;
--
--   -- a credit sale should book exactly one debit and no cash
--   insert into business_transactions (owner_id, type, amount, customer_id, bill_date)
--     values (book_owner, 'sale', 5000, party, current_date) returning id into bill;
--   select entry_type, amount, source into posted
--     from customer_ledger_entries where customer_id = party;
--   raise notice 'after the sale: % % (source %)', posted.entry_type, posted.amount, posted.source;
--
--   -- editing it should move that debit, not add a second one
--   update business_transactions set amount = 7000 where id = bill;
--   raise notice 'after the edit: % entries, total %',
--     (select count(*) from customer_ledger_entries where customer_id = party),
--     (select sum(amount) from customer_ledger_entries where customer_id = party);
--
--   -- deleting it should take the posting with it
--   delete from business_transactions where id = bill;
--   raise notice 'after the delete: % entries',
--     (select count(*) from customer_ledger_entries where customer_id = party);
-- end
-- $test$;
-- rollback;
--
-- Expect: debit 5000 (source booking) -> 1 entry totalling 7000 -> 0 entries.
-- =====================================================================
