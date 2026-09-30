# Finance module — behaviour spec

What to build on top of `01_finance_schema.sql`, so the screens behave the
way the Jageer ones do. The database half ports verbatim; this half is the
part that has to be rebuilt in your frontend, and this document is what it
has to match.

Every formula below is the live one, copied out of the working app. They
look redundant — several screens count "money in" — but they must agree
exactly, or two screens show two different balances and nobody trusts
either. Put them in one shared module and have every screen call it.

---

## 1. The model in four rules

**1. A bill is not money.** A sale or purchase records that someone now
owes someone. The cash arrives later, as its own payment entry. So a
100,000 sale does not raise your bank balance by one rupee — it raises
"to receive" by 100,000.

**2. An expense is money.** It is paid on the spot. It is the only
`business_transactions` row that moves cash by itself.

**3. A bill with no party is money.** A walk-in with no saved customer has
no ledger to settle later, so its cash moved when it was recorded. This
one exception is why the helper `isSettledOnTheSpot` exists and why every
cash formula below mentions it:

```ts
const isSettledOnTheSpot = (t) =>
  (t.type === 'sale' || t.type === 'purchase') && !t.customer_id;
```

**4. Cash in hand is `bank_account_id = null`.** Not a row in
`bank_accounts`, not a magic id. Every balance groups by
`bank_account_id ?? 'cash'`.

Two more things worth knowing before you read any further:

- `customers` holds **both** customers and vendors. Which side someone is
  on is decided per entry, by which ledger it lands in. One person can owe
  you and be owed by you at once, and the UI shows both numbers rather
  than netting them.
- Every entry's date is `entry_date ?? created_at` (bills:
  `bill_date ?? created_at`). The user-entered date wins everywhere;
  `created_at` is only the fallback for rows saved before dating existed.
  Getting this wrong puts back-dated entries in the wrong month on some
  screens and the right month on others.

---

## 2. The canonical formulas

### 2.1 What a party owes / is owed

```ts
// per party
receivable = Σ customer_ledger_entries (debit − credit)   // they owe you
payable    = Σ vendor_ledger_entries   (debit − credit)   // you owe them

// business totals: only count parties on the wrong side of zero, so one
// customer in credit never cancels out another's debt
totalReceivable = Σ max(receivable, 0) over parties
totalPayable    = Σ max(payable, 0)    over parties
```

A party with both at zero reads **"Settled"**, not "0".

### 2.2 Available balance (cash + every bank account)

This is the one "how much money do we actually have" number. Everything
that displays a balance derives from it.

```ts
balance[bank_account_id ?? 'cash'] += ...

// bills, only the party-less ones
for (t of business_transactions)
  if (isSettledOnTheSpot(t))  add(t.bank_account_id, t.type === 'sale' ? +t.amount : −t.amount)
  if (t.type === 'expense')   add(t.bank_account_id, −t.amount)

// customer ledger
for (e of customer_ledger_entries)
  if (e.entry_type === 'credit')                       add(e.bank_account_id, +e.amount)  // received
  if (e.entry_type === 'debit' && e.source === 'manual') add(e.bank_account_id, −e.amount) // refund out

// vendor ledger
for (e of vendor_ledger_entries)
  if (e.entry_type === 'credit') add(e.bank_account_id, −e.amount)   // you paid them

// transfers move between your own accounts and never change the total
for (t of account_transfers) {
  add(t.from_account_id, −t.amount);
  add(t.to_account_id,   +t.amount);
}

total = Σ every bucket
```

Note what is **excluded**: booking-sourced debits (a sale's debt, a job's
debt). Those are money owed, not money held.

Keep the per-entry list alongside the sums — each account's balance should
be openable into the lines that make it up, or a wrong total is
un-debuggable.

### 2.3 Total received / total paid

Same definitions, without the per-account split:

- **Received** — customer ledger credits (manual payments *and* posted job
  payments), plus party-less sales.
- **Paid** — every expense, manual customer debits, vendor ledger credits,
  plus party-less purchases.

Bucket by `entry_date ?? created_at`, never `created_at` alone.

### 2.4 Profit & loss

Straight off the bills, for *this month* / *this year* / *all time*:

```
gross profit = Σ sale − Σ purchase
net profit   = gross profit − Σ expense
```

Filter by `bill_date ?? created_at`. This is billed profit, not collected
cash — show the available balance next to it so the difference is visible.

---

## 3. The screens

Eleven screens. Build them in the order under §6.

### 3.1 Day Book — the one that matters

A paper cash book for a single day. If you only port one screen, port this
one; it is where the owner actually works.

**One table, in time order:**

| Time | Transaction details | Type | Invoice | Discount | Bill amount | Cash in | Cash out | Balance |

Narrow screens (under ~1280px beside a sidebar) collapse to four columns —
Time, Details, Amount, Balance — with type, note and invoice stacked
inside the details cell. Do not horizontally scroll a nine-column table on
a phone.

**Rows, in this order:**

1. **Opening balance** — every cash movement dated *before* this day. Inert,
   greyed, no amount.
2. Everything dated on this day, sorted by `created_at`:
   - *Cash in* — customer ledger credit → "Received from «party»"
   - *Paid out* — manual customer debit, or a vendor ledger credit → "Paid to «party»"
   - *Expense* — cash out
   - *Sale bill* / *Purchase bill* — the bill total in **Bill amount**, and
     **nothing** in cash in/out or the balance column
   - *Transfer* — "Cash → Nabil", amount shown, balance untouched
3. **Closing balance** footer, with the arithmetic spelled out:
   `Opening 12,000 + In 8,000 − Out 3,000 = Closing balance 17,000`

**Which ledger rows appear.** A sale already appears as its own bill row,
so its booking debit must be skipped or the day counts it twice:

```ts
// customer ledger
const isIn = e.entry_type === 'credit';
if (!isIn && e.source !== 'manual') continue;   // booking debits are the Sale itself

// vendor ledger
if (e.entry_type !== 'credit') continue;        // debits are the Purchase itself
```

**Running balance:** starts at opening; only rows with a cash in/out value
advance it, and only those rows show a balance. Bills and transfers leave
the column blank.

**Invoice column** is the value before discount and VAT:
`amount + discount_amount − vat_amount`.

**Header:** business name, `Day Book · «date»` with the other calendar
underneath, ‹ › day arrows, a date picker, a "Today" button that appears
only when you are not on today, and forward navigation disabled past
today. Above the table, stat tiles: Opening, Cash in, Cash out, Closing,
plus Sales billed / Purchases billed when non-zero.

**Editing.** Tapping any row opens it in a modal — the same field layout as
the payment form, so an entry reads the way it was written: Details (date +
receipt/bill no) · Payment method · Party · Amount (+ discount) + note.
Which fields show depends on the row:

| Row | Table | Editable fields | Number field |
|---|---|---|---|
| Sale / Purchase / Expense | `business_transactions` | party, bill no, discount, method, amount, note, date | Bill No. |
| Received / Paid to customer | `customer_ledger_entries` | method, amount, note, date, receipt | Receipt No. / Payment No. |
| Paid to vendor | `vendor_ledger_entries` | same | Payment No. |
| Transfer | `account_transfers` | date, amount, note | — |

Rows with `source !== 'manual'` open **read-only**, with an amber note
saying why: *"This was recorded by a job when its payment was collected.
Change it on the job, and this entry follows."* The RLS policies enforce
this too — the UI just explains it before the database refuses.

Delete asks twice **in the sheet**, not in a popup: the button turns red and
reads "Tap again to delete for good", reverting after 5 seconds. The
confirmation lands under the finger that just tapped, and cannot hide
behind the modal.

After any save or delete, invalidate all four tables — a bill's trigger
writes to the ledgers, so refreshing only the edited table leaves the
screen wrong.

**New entry** is one button with a five-item menu: Received · Payment Out ·
Sale · Purchase · Expense. Each opens the corresponding form. Resist
splitting this back into five buttons.

### 3.2 Dashboard

- **Available balance** (§2.2), opening into the per-account breakdown.
- **To Receive / To Give** tiles (§2.1), each opening a list of who makes
  it up. Green/emerald for receive, red for give — consistently, everywhere.
- Five stat tiles: Sales, Purchase, Expense (this period) and Total
  Received, Total Paid (this year). On a wide screen they sit in one row of
  five; on a phone, 3 + 2.
- **Cashflow chart**: in vs out, either the last 7 days or the last 6
  months. Same definitions as §2.3, bucketed by entry date.
- **Shortcut grid**: Day Book · Ledger · Received · Payment Out · Sales ·
  Purchase · Expenses · Bank Accounts · Import Statement · Inventory ·
  Report.

### 3.3 Ledger (party list)

Search by name or phone. Two totals at the top (To receive / To pay), then
one row per party with name, phone, address and a balance line: *To receive
NPR x*, *To pay NPR y*, both, or *Settled*. Tapping a party opens their
statement.

Adding a party: name (required), 10-digit phone, address. Before insert,
look up the phone within this owner's parties — if it exists, offer to open
that party instead of refusing. The unique index enforces it anyway; the
lookup is so the user gets a way forward instead of a raw error.

### 3.4 Party detail

Balance card — *"Customer owes you NPR 5,000"* / *"You owe customer"* /
*"Balance"* — then the entries, newest first, each showing whether it was a
debt or a payment, its date, note and amount. If the party also has vendor
entries, a second card and second list below, clearly separated. Editable
details (name, phone, address) and a delete that warns the ledger goes with
it (`on delete cascade`).

### 3.5 Received / Payment Out

One form, two directions — and the direction decides the table, which is
the bug this design exists to prevent:

| | Table | entry_type |
|---|---|---|
| **Received** (money in) | `customer_ledger_entries` | `credit` |
| **Payment Out** (money out) | `vendor_ledger_entries` | `credit` |

Payment Out is a *vendor* payment. Booking it as a customer debit inflates
"to receive" for someone you only ever bought from.

Fields: party (picker over saved parties + phone contacts) · date ·
receipt/payment no · amount · note · payment method (cash or a bank
account). Saving writes `source: 'manual'`.

**Receipt numbering.** Auto-fills `001`, `002`, … from the highest number
already used *in this direction* (same table, same `entry_type`,
`source = 'manual'`):

```ts
const nums = entries.map(e => Number((e.receipt_no ?? '').replace(/\D/g, '')))
                    .filter(n => Number.isFinite(n) && n > 0);
const next = (nums.length ? Math.max(...nums) : entries.length) + 1;
return String(next).padStart(3, '0');
```

Falling back to the row count matters: entries saved before numbering
existed have no `receipt_no`, and without the fallback the suggestion
sticks at `001` forever. Stop auto-filling the moment the user types in the
field, but keep updating until then.

**Typing a name that isn't saved creates the party on save.** A payment must
link to a real party id; sending the user off to a Parties screen first is
a dead end.

**Wide screens** get a multi-row table — one date, one receipt no, one
payment method, several people and amounts saved together. Each row leaves
the table as it saves, so a failure halfway through can be retried without
double-recording.

### 3.6 Sale / Purchase / Expense

One form, three types.

**Sale and purchase are itemised bills.** Line items — description, qty,
rate, computed amount — picked from your catalog, from previously typed
items (`finance_items`), or typed fresh. A freshly typed name is saved to
`finance_items` (upsert on `owner_id,name`) so it can be picked next time;
if that save fails the line still goes on the bill, with a note saying it
was not remembered.

```
subtotal    = Σ qty × rate   (only lines with a description, qty > 0, rate ≥ 0)
discount    = a plain NPR amount (its % is display-only)
vat         = round((subtotal − discount) × vatPercent / 100)
grand total = subtotal − discount + vat      → business_transactions.amount
```

Discount and VAT are independent collapsible rows. **VAT defaults to 0, not
13** — the row starts collapsed, and a default of 13 silently baked VAT into
every bill whose VAT row was never opened. 13% fills in only when the user
turns VAT on.

A bill **requires a saved party** (`customer_id`). Without one it books no
debt and silently becomes a cash sale. Block the save and say so: *"Every
purchase books against a real vendor's ledger — tap the Vendor field and
choose or add one."*

**An expense** is simpler: date, payee name, category (managed inline —
create, rename, delete), amount, note, payment method. `payment_mode` is
`'bank'` when an account is chosen, `'cash'` otherwise. Wide screens get the
same multi-row table as §3.5.

Below the form, the feed of existing entries: bills, ledger entries and
transfers interleaved, grouped by day, filterable by type.

### 3.7 Bank accounts

List with each account's balance from §2.2 and cash in hand alongside.
Add/edit: name (unique per owner, case-insensitive), bank name, account
number, account holder, address. Opening an account lists the entries
behind its balance. Transfers between accounts are recorded here.

### 3.8 Import statement

1. Pick an `.xls`/`.xlsx` export. The parser finds the header row (the
   Jageer one keys on a `Reference Code` first column) and reads
   reference · datetime · description · debit · credit · status.
2. **Skip anything whose status is not COMPLETE** — pending and failed rows
   were never real money.
3. Drop rows whose reference code is already in `statement_imports`. This
   is what makes re-importing an overlapping export safe.
4. Classify each row from its description and direction:

   | Description pattern | Becomes |
   |---|---|
   | `Fund Transferred to X` | Payment out → vendor, party X |
   | `Fund Transferred by X` | Payment in → customer, party X |
   | `Money transferred to/from X` | Withdraw / Deposit (own money) |
   | `Loan Disbursement from X` | Deposit |
   | `Paid for X`, `X topup to …` | Expense, payee X |
   | charges, cashback, fees | Withdraw / Deposit |
   | anything else | debit → Expense, credit → Payment in |

5. Show every row for review with its type, party and category editable and
   a checkbox. Nothing is written until the user commits.
6. On commit: expenses → `business_transactions`; payment in → customer
   credit; payment out → vendor credit; withdraw/deposit → nothing but the
   `statement_imports` marker, since that is the owner's own money moving.
   Parties are matched case-insensitively by name and created once per name,
   not once per row. Each row's marker is written in the same pass, so a
   partial failure can be re-run safely.

Adapt the patterns to whatever your banks export — the *structure* (parse →
dedupe by reference → classify → review → commit with a marker) is the part
to keep.

### 3.9 Report / Totals / Inventory

- **Report** — §2.4, with a period switch and the available balance below.
- **Totals** — Total Received / Total Paid, a bar chart by week or month,
  and the underlying entries listed, each linking to its source.
- **Inventory** — products and `finance_items` cross-referenced with how
  many units moved through sale and purchase bills. Matched **by item name,
  lowercased and trimmed**, because bill lines carry typed names, not
  foreign keys. Do not promise stock-level accuracy off this.

---

## 4. Cross-cutting

**Dates.** Nepali businesses read Bikram Sambat. Store AD `date` in
Postgres, always; convert at the edge. One app-wide BS/AD preference,
persisted, flipping every date label at once — and show the other calendar
underneath the main one on headers, so nobody has to convert in their head.
"Today" must be the *local* day: `toISOString()` is UTC and shifts
late-evening Nepal entries into the next day.

**Money.** `Math.round(n).toLocaleString()`, prefixed `NPR`. No decimals
anywhere in the UI; the column is `numeric` so nothing is lost. Null renders
as `—`, never `0` — "nothing here" and "zero" are different facts.

**Colours,** used consistently or the tables stop being readable at a
glance: money in `#047857`, money out `#B91C1C`, sale `#1D4ED8`, purchase
`#6D28D9`, transfer `#4338CA`, balance `#2563EB` (red when negative).

**Caching.** Query keys of `[table, filters, orderBy]`; after any write,
invalidate the table *and* every table its triggers touch. A sale write
invalidates both ledgers.

**Export.** PDF via a print stylesheet, XLSX via SheetJS, both from the same
column definition so they cannot drift.

---

## 5. Two wrinkles to fix, not copy

**The Day Book's opening balance is not quite §2.2.** It sums prior-day
expenses and ledger entries, but not party-less sales and purchases, which
§2.2 counts as cash. A walk-in cash sale yesterday therefore shows in the
available balance but not in today's opening balance. Build the opening
balance by calling the shared §2.2 formula with a date cutoff instead of
re-implementing it, and the two can never disagree.

**`payment_mode` on bills is always `'cash'`.** The form hardcodes it (and
`bank_account_id: null`) because a bill is a debt, not a payment — the
column is a leftover from before that rule. Either drop it or make it mean
something; do not read it.

---

## 6. Build order

1. Schema (`01_finance_schema.sql`), then the smoke test at the bottom of it.
2. The shared money module — §2, all four formulas, with tests. Everything
   else reads from here.
3. Parties list + party detail. Proves RLS and the two-ledger model.
4. Received / Payment Out. First real writes.
5. Sale / Purchase / Expense. First trigger-driven posting — check that a
   sale creates exactly one debit, that editing it moves that debit, and
   that deleting it removes the debit.
6. Day Book. Everything before this has to be right for it to add up.
7. Dashboard, Report, Totals.
8. Bank accounts and transfers.
9. Statement import.
10. Inventory, export.

A useful end-to-end check once 1–6 are up, and the shape of the tests worth
keeping: sell 10,000 to a party on credit → to-receive 10,000, available
balance unchanged, Day Book shows a bill row with no cash. Receive 4,000 →
to-receive 6,000, balance +4,000, Day Book shows a cash-in row. Delete the
bill → to-receive goes to −4,000 (they are in credit), the payment survives.
That last step is not a bug; it is what the `on delete` branch of the
trigger is for.
