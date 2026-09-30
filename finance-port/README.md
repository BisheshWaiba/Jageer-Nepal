# Finance module — port kit

Everything needed to run Jageer Nepal's finance system as a second,
independent installation: **its own Supabase project, its own books**,
sharing nothing with Jageer but the design.

This exists because a markdown description on its own would mean retyping
~8,200 lines of screen code *and* re-deriving accounting rules that are
currently enforced by database constraints and triggers. The rules are the
valuable part and they port verbatim; only the screens have to be rebuilt.

## What's here

| File | What it is |
|---|---|
| `00_STEP_BY_STEP.md` | The runbook: what to do in what order, with a check at the end of every step. Start here. |
| `01_finance_schema.sql` | The whole database half, self-contained. 9 tables, their indexes, RLS policies and the posting triggers, consolidated from ~28 migrations and dumped from the live database, so it matches what is actually running rather than what the migration files say. |
| `02_posting_from_your_documents.sql` | Optional. How to make your own documents (a job, a work order, an order) post themselves into the books, with the four rules that stop money being double-counted. |
| `FINANCE-SPEC.md` | The other half: every balance formula, and what each of the eleven screens does. Written to be rebuilt from, on any frontend. |

## Installing

1. Create the Supabase project (or pick the schema) that will hold the
   second set of books.
2. Open `01_finance_schema.sql`, read the **ADAPTER** block at the top, and
   set two things: the **ownership model** — per user (the default) or per
   company, which is what a multi-tenant ERP wants — and how
   `finance_is_admin()` decides who is an admin. Returning `false` is a
   fine answer. `00_STEP_BY_STEP.md` §1.2 has the exact commands for
   either model.
3. Run the file. It is one transaction — it either installs completely or
   not at all — and it is re-runnable.
4. Run the smoke test commented at the bottom: it inserts a party and a
   sale, checks that the trigger booked exactly one debit, and rolls back.
5. Build the frontend against `FINANCE-SPEC.md`, in the order given in its
   §6.

## What you are getting

- **Two ledgers, one party table.** The same person can owe you and be owed
  by you; the two numbers are shown side by side rather than netted.
- **Bills are debts, payments are money.** A sale raises "to receive", not
  your balance. This one rule is why the balance figures can be trusted.
- **Postings are idempotent.** Every automatic entry carries
  `(source_type, source_id)` and upserts on it, so a trigger that fires
  five times still leaves one row, and a document that stops qualifying
  has its entry removed rather than stranded.
- **Trigger-written entries are read-only** at the RLS level, not just in
  the UI, so nobody can "fix" a job's payment in the ledger and have the
  next trigger run silently overwrite it.
- **One switch decides who owns a book.** Per-user or per-company, chosen
  by a single function; the column name, the formulas, the indexes and the
  screens are the same either way. Under the company model `owner_id` is
  stamped server-side on insert, so a client never sends it and cannot
  send someone else's.
- **Statement import can't double-count**, because every imported line is
  remembered by the bank's own reference code.

## What you are not getting

Deliberately left out, because it is Jageer-specific:

- Service requests, jobs, technicians, orders and the triggers that post
  them. `02_posting_from_your_documents.sql` shows the pattern if you want
  the same for your own documents.
- Any product catalog. `finance_items` covers billing line items on its
  own; the Inventory screen cross-references a catalog if you have one.
- Phone-contact sync, bill scanning and voice entry. The columns they use
  (`customers.phone_contact_id`) are kept so the tables match, and are
  harmless if unused.

## Differences from the live Jageer database

Two, both deliberate, both noted where they occur:

1. `updated_at` is now maintained by a trigger. Jageer never wired one onto
   these tables, so its `updated_at` values are really creation times.
   Nothing reads them, so nothing can break.
2. `is_admin()` became `finance_is_admin()`, so the module carries its own
   definition instead of depending on a `profiles.role` column.

`FINANCE-SPEC.md` §5 lists two things in the live app worth fixing rather
than reproducing — the Day Book's opening balance drifting from the
available balance, and the vestigial `payment_mode` column on bills.

## Keeping the two in sync

They are separate books and will drift. If a fix lands in Jageer's finance
schema that you want here, it is a normal migration in this project too —
there is no shared deployment, and nothing here reads Jageer's database.
Regenerate this kit from the live schema (rather than from the migration
files) if it ever needs refreshing; the migration files have drifted from
the database before.
