# Porting the finance module — step by step

The order to do this in, with a check at the end of every step so you
always know whether to carry on or stop and fix something.

Read `README.md` for what the kit is. This file is the runbook.

The one rule that makes the rest go smoothly: **finish Phase 1 and Phase 3
completely before building a single screen.** The database and the money
formulas are what every screen reads from. Building screens first means
discovering a wrong formula eleven times instead of once.

---

## Before you start

Have these in hand:

- [ ] Access to the target Supabase project — the SQL editor is enough, a
      direct connection string is nicer.
- [ ] One real user id in that project (`select id, email from auth.users
      limit 5;`). You need it for the smoke test.
- [ ] A decision on **who owns a book**: `auth.users`, or your own
      `profiles`/`users` table.
- [ ] A decision on **who is an admin**: a role column, a JWT claim, or
      nobody. "Nobody" is a fine answer — owners still see their own books.
- [ ] The target repo checked out.

---

## Phase 1 — Database

### 1.1 Copy the kit in

Copy `finance-port/` into the target repo. The two `.sql` files are what
get run; the `.md` files are for whoever builds the screens.

### 1.2 Edit the adapter block

Open `01_finance_schema.sql`. The **ADAPTER** block is the first ~40 lines
and the only part you normally change.

**If your owner is not `auth.users`:** find and replace
`references auth.users(id)` with `references public.profiles(id)` (or
whatever your table is). There are nine of them, one per table.

**Set the admin rule** in `finance_is_admin()`. Three common bodies:

```sql
-- a role column on your own profiles table (this is what Jageer does)
select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);

-- a JWT app-metadata claim (the default in the file)
select coalesce((select (raw_app_meta_data ->> 'role') = 'admin' from auth.users where id = auth.uid()), false);

-- nobody is an admin
select false;
```

### 1.3 Run it

Paste the whole file into the Supabase SQL editor and run it. Or:

```bash
psql "$TARGET_DB_URL" -f finance-port/01_finance_schema.sql
```

It is one transaction — it installs completely or not at all — and it is
re-runnable, so a failure halfway is safe to fix and re-run.

### 1.4 Check it landed

```sql
-- expect 9
select count(*) from information_schema.tables
 where table_schema = 'public'
   and table_name in ('customers','bank_accounts','account_transfers',
                      'expense_categories','finance_items','business_transactions',
                      'customer_ledger_entries','vendor_ledger_entries','statement_imports');

-- expect 24
select count(*) from pg_policies where schemaname = 'public'
   and tablename in ('customers','bank_accounts','account_transfers',
                     'expense_categories','finance_items','business_transactions',
                     'customer_ledger_entries','vendor_ledger_entries','statement_imports');

-- expect 9 rows, all t — a false here means that table is wide open
select relname, relrowsecurity from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and relname in ('customers','bank_accounts','account_transfers',
                   'expense_categories','finance_items','business_transactions',
                   'customer_ledger_entries','vendor_ledger_entries','statement_imports');
```

### 1.5 Smoke-test the posting triggers

The block is commented at the bottom of `01_finance_schema.sql`. Put a
real user id in `book_owner`, uncomment, run the whole thing.

Expected notices, in order:

```
after the sale:   debit 5000 (source booking)
after the edit:   1 entries, total 7000
after the delete: 0 entries
```

It rolls itself back, so it leaves nothing behind.

**If the first notice says 0 rows:** the trigger did not fire. Check that
both triggers exist on `business_transactions`
(`select tgname from pg_trigger where tgrelid = 'business_transactions'::regclass and not tgisinternal;`).

**If the second says 2 entries:** the partial unique index on
`(source_type, source_id)` is missing, so the upsert inserted instead of
updating. Re-run section 4 of the install script.

### 1.6 Seed the starting data

Not required, but every book needs these before it is usable:

```sql
insert into expense_categories (owner_id, name) values
  ('<owner>','Fuel'), ('<owner>','Rent'), ('<owner>','Salary'),
  ('<owner>','Tools'), ('<owner>','Office');

insert into bank_accounts (owner_id, name, bank_name) values
  ('<owner>','Main account','<bank>');
```

Do **not** create a "Cash" bank account. Cash in hand is
`bank_account_id = null`, and a real Cash row would be counted twice.

> **Gate.** Do not start Phase 2 until 1.4 and 1.5 both pass.

---

## Phase 2 — Types and the data layer

### 2.1 Generate types

```bash
npx supabase gen types typescript --project-id <target-project-ref> --schema public \
  > types/database.types.ts
```

### 2.2 Write the query wrapper

Whatever your framework, you need three things:

- **Keys** built as `[table, filters, orderBy]`, so a write can invalidate
  by table name alone.
- **An owner filter on every read.** RLS enforces it anyway, but filtering
  client-side too keeps the payloads small and makes a missing policy
  obvious in testing instead of invisible.
- **An invalidation rule: after any write, invalidate that table *and*
  every table its triggers touch.** Concretely, writing a
  `business_transactions` row must also invalidate
  `customer_ledger_entries` and `vendor_ledger_entries`. Forgetting this is
  the single most common bug in the original app — the screen looks stale
  and everyone blames the database.

### 2.3 Prove RLS actually isolates

This is worth doing properly once, now, rather than discovering it in
production.

1. Sign in as user A, insert a party, read it back — expect 1 row.
2. Sign in as user B, read `customers` — expect **0 rows**, not an error.
3. As user B, try to update A's party by id — expect 0 rows affected.
4. As user A, try to insert a ledger entry with `source: 'booking'` —
   expect a policy violation. Only triggers may write booking rows.

If step 2 returns A's data, you are connecting with the service-role key
somewhere. Fix that before going further; nothing else in this list
matters if that is broken.

---

## Phase 3 — The money module

The most important code you will write. Everything else reads from it.

### 3.1 Implement the four formulas

From `FINANCE-SPEC.md` §2, in one file:

- `partyBalances(customerEntries, vendorEntries)` → per-party
  `{receivable, payable}` plus the two business totals.
- `accountBalances(transactions, customerEntries, vendorEntries, transfers, accounts)`
  → per-account balances, cash bucket, grand total, and the per-entry
  list behind each.
- `receivedAndPaid(...)` → the two cash-flow totals over a date range.
- `profitAndLoss(transactions, range)` → sales, purchases, expenses,
  gross, net.

Plus the shared helper everything references:

```ts
const isSettledOnTheSpot = (t) =>
  (t.type === 'sale' || t.type === 'purchase') && !t.customer_id;
```

Two things to get right while you are here, both flagged in
`FINANCE-SPEC.md` §5:

- Every date read is `entry_date ?? created_at` (bills:
  `bill_date ?? created_at`). No exceptions, or back-dated entries land in
  different months on different screens.
- Build the Day Book's opening balance by calling `accountBalances` with a
  date cutoff, **not** by re-implementing it. That drift is a live bug in
  the original app; do not port it.

### 3.2 Test it with fixtures

Hand-written fixtures, no database. The scenario worth encoding, with the
numbers it must produce:

| Step | to receive | available balance |
|---|---|---|
| Sell 10,000 to Ram on credit | 10,000 | 0 |
| Receive 4,000 from Ram (cash) | 6,000 | 4,000 |
| Expense 1,000 (cash) | 6,000 | 3,000 |
| Walk-in sale 2,000, no party | 6,000 | 5,000 |
| Buy 3,000 from Shyam on credit | 6,000 (and to pay 3,000) | 5,000 |
| Pay Shyam 3,000 | to pay 0 | 2,000 |
| Transfer 1,000 cash → bank | unchanged | 2,000 (cash 1,000, bank 1,000) |

If your module produces those seven rows, the formulas are right.

> **Gate.** Do not start Phase 4 until 3.2 passes.

---

## Phase 4 — Screens, in this order

Each one only depends on the ones above it. Build, check, move on.

### 4.1 Parties list + party detail — `FINANCE-SPEC.md` §3.3, §3.4

The smallest real screen, and it proves RLS, the two-ledger model and your
query layer all at once.

**Done when:** you can add a party, see "Settled", and adding the same
phone number again offers to open the existing party instead of erroring.

### 4.2 Received / Payment Out — §3.5

**Done when:** a Received entry lands in `customer_ledger_entries` as a
`credit`, a Payment Out lands in `vendor_ledger_entries` as a `credit`, and
both auto-number `001`, `002`, … independently of each other.

This is the direction bug the design exists to prevent — check it in the
database, not just in the UI.

### 4.3 Sale / Purchase / Expense — §3.6

**Done when:** saving a sale creates the bill **and** exactly one booking
debit on the party; editing the amount moves that debit; deleting the bill
removes it. VAT defaults to 0 and only becomes 13% when switched on. A bill
with no party is refused with a message, not silently saved.

### 4.4 Day Book — §3.1

The big one, and the screen people actually work in. Everything above has
to be right for its numbers to add up.

**Done when:** opening + in − out = closing, bill rows show a bill amount
but no cash and no balance, and a row written by a trigger opens read-only
with the explanation.

### 4.5 Dashboard, Report, Totals — §3.2, §3.9

Mostly presentation over Phase 3. No new writes.

**Done when:** the dashboard's available balance equals the Day Book's
closing balance for today. If they differ, the bug is in whichever one
re-implemented a formula instead of calling the shared module.

### 4.6 Bank accounts and transfers — §3.7

**Done when:** a transfer changes both accounts and leaves the grand total
untouched.

### 4.7 Statement import — §3.8

Adapt the description patterns to whatever your banks export. Keep the
structure: parse → drop non-COMPLETE rows → drop reference codes already in
`statement_imports` → classify → **review** → commit with a marker.

**Done when:** importing the same file twice imports nothing the second
time.

### 4.8 Inventory and export — §3.9, §4

The last things, and the most skippable.

---

## Phase 5 — Wire in your own documents (optional)

Only if your ERP has jobs, work orders or sales orders that should appear
in the books by themselves. Follow
`02_posting_from_your_documents.sql` and its four rules.

**Done when:** completing a document books a receivable, recording a part
payment books what was actually received, cancelling it removes both, and
doing all of that twice leaves one row of each, not two.

---

## Phase 6 — Before you call it live

- [ ] Re-run the Phase 1.4 checks against the production project.
- [ ] Re-run the Phase 2.3 isolation test with two real accounts.
- [ ] Walk the Phase 3.2 scenario through the actual UI, end to end, and
      confirm the numbers match the table.
- [ ] Confirm no screen re-implements a Phase 3 formula
      (`grep` for `entry_type === 'credit'` outside the money module —
      every hit is a future disagreement between two screens).
- [ ] Confirm backups are on for the project.

---

## Appendix — queries worth keeping

```sql
-- who owes what, straight from the database
select c.name,
       coalesce(sum(case when e.entry_type = 'debit'  then e.amount else -e.amount end), 0) as receivable
  from customers c
  left join customer_ledger_entries e on e.customer_id = c.id
 where c.owner_id = '<owner>'
 group by c.name having coalesce(sum(case when e.entry_type = 'debit' then e.amount else -e.amount end), 0) <> 0
 order by 2 desc;

-- orphaned postings: a booking entry whose source document is gone.
-- Should always return 0 rows; anything here means a delete branch is missing.
select * from customer_ledger_entries
 where source_type = 'business_transaction'
   and source_id not in (select id from business_transactions);

-- entries nobody can edit, and why (source = booking means a trigger owns it)
select source, count(*) from customer_ledger_entries group by 1;
```
