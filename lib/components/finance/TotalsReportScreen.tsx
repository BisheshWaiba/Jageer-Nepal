// lib/components/finance/TotalsReportScreen.tsx
import { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { isSettledOnTheSpot } from '../../hooks/useAccountBalances';
import { BS_MONTHS, adStringToBs, toBsDayChartLabel, toBsMonthChartLabel } from '../../utils/nepaliDate';
import { BarChart } from '../BarChart';
import { MONEY } from './moneyColors';
import { BackButton, BookPage, BookStat, BookStats, BookTable, FilterTabs, Pill, money, useBookLayout, useBookToolbar, type BookColumn } from './BookKit';

const DAY_MS = 24 * 60 * 60 * 1000;

type Kind = 'received' | 'paid';
type Granularity = 'week' | 'month';

type NavTarget = { kind: 'transactions'; type: 'expense' | 'sale' | 'purchase' } | { kind: 'party'; partyId: string };

interface PillStyle {
  label: string;
  color: string;
  bg: string;
}

const PILL = {
  sale: { label: 'Sale', color: MONEY.in.text, bg: MONEY.in.bg },
  purchase: { label: 'Purchase', color: MONEY.out.text, bg: MONEY.out.bg },
  expense: { label: 'Expense', color: MONEY.out.text, bg: MONEY.out.bg },
  paymentReceived: { label: 'Payment received', color: MONEY.in.text, bg: MONEY.in.bg },
  jobPayment: { label: 'Job payment', color: MONEY.in.text, bg: MONEY.in.bg },
  paymentOut: { label: 'Payment out', color: MONEY.out.text, bg: MONEY.out.bg },
  paidVendor: { label: 'Paid vendor', color: MONEY.out.text, bg: MONEY.out.bg },
} satisfies Record<string, PillStyle>;

interface Entry {
  id: string;
  date: string;
  amount: number;
  /** Who it was with - a customer, vendor or the bill's party; empty if none. */
  party: string;
  note: string;
  type: PillStyle;
  nav: NavTarget;
}

const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

const KIND_META: Record<Kind, { title: string; subtitle: string; color: string }> = {
  received: { title: 'Total Received', subtitle: 'Money actually collected, newest first', color: '#059669' },
  paid: { title: 'Total Paid', subtitle: 'Money that actually left the business, newest first', color: '#DC2626' },
};

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfWeek(d: Date) {
  const day = startOfDay(d);
  const dow = day.getDay() === 0 ? 7 : day.getDay(); // Monday = 1 ... Sunday = 7
  return new Date(day.getTime() - (dow - 1) * DAY_MS);
}

/** "Aswin 2083 BS" - the table's month rows. Dates are stored as AD strings
 * ('YYYY-MM-DD' or a full timestamp); Nepal reads them in Bikram Sambat. */
function bsMonthGroup(date: string): string {
  const bs = adStringToBs(date.slice(0, 10));
  return bs ? `${BS_MONTHS[bs.month]} ${bs.year} BS` : 'Other';
}
/** "Aswin 15" - the Date column. */
function bsShortDate(date: string): string {
  const bs = adStringToBs(date.slice(0, 10));
  return bs ? `${BS_MONTHS[bs.month]} ${bs.date}` : '';
}

export function TotalsReportScreen({ kind, basePath }: { kind: Kind; basePath: string }) {
  const meta = KIND_META[kind];
  const layout = useBookLayout();
  const userId = useAuthStore((state) => state.session?.user.id);
  const { data: transactions } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { data: ledgerEntries } = useSupabaseQuery('customer_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { data: vendorEntries } = useSupabaseQuery('vendor_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { data: customers } = useSupabaseQuery('customers', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { data: categories } = useSupabaseQuery('expense_categories', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    (customers ?? []).forEach((c) => map.set(c.id, c.name));
    return map;
  }, [customers]);
  const categoryById = useMemo(() => {
    const map = new Map<string, string>();
    (categories ?? []).forEach((c) => map.set(c.id, c.name));
    return map;
  }, [categories]);

  const [granularity, setGranularity] = useState<Granularity>('month');
  const year = new Date().getFullYear();

  // The Week / Month switch (for the chart) sits in the top bar on a wide screen.
  const toolbar = useBookToolbar(
    {
      wide: layout.wide,
      left: layout.wide ? undefined : () => <BackButton onPress={() => router.back()} />,
      right: () => <FilterTabs options={GRANULARITIES} value={granularity} onChange={setGranularity} />,
    },
    [granularity]
  );

  // "Received" = every payment actually collected from a customer, whether
  // logged manually (Payment In) or synced from a paid booking - NOT Sales,
  // which since 0061_sale_purchase_always_ledger.sql book a debt rather than
  // cash received. "Paid" = real cash out: Expenses, manual Payment Out to a
  // customer, and payments actually made to a vendor - a Purchase itself is
  // a debt too now, not cash spent, same as booking-sourced debit entries
  // are excluded since those represent money owed, not money that's left
  // the business yet.
  const entries = useMemo((): Entry[] => {
    const list: Entry[] = [];
    for (const t of transactions ?? []) {
      // A Sale/Purchase with no party has no ledger to settle it later (a
      // paid walk-in job, a delivered cash-on-delivery order) - its money
      // moved on the spot. Same rule as useAccountBalances.
      if (isSettledOnTheSpot(t) && (kind === 'received') === (t.type === 'sale')) {
        list.push({
          id: t.id,
          date: t.bill_date ?? t.created_at,
          amount: t.amount,
          party: t.party_name ?? '',
          note: t.note ?? '',
          type: t.type === 'sale' ? PILL.sale : PILL.purchase,
          nav: { kind: 'transactions', type: t.type === 'sale' ? 'sale' : 'purchase' },
        });
      }
      if (kind === 'paid' && t.type === 'expense') {
        // Same as the Transactions list: the payee if there is one, else the category.
        const category = t.expense_category_id ? categoryById.get(t.expense_category_id) : undefined;
        list.push({
          id: t.id,
          date: t.bill_date ?? t.created_at,
          amount: t.amount,
          party: t.party_name || category || '',
          note: [t.party_name ? category : null, t.note].filter(Boolean).join(' · '),
          type: PILL.expense,
          nav: { kind: 'transactions', type: 'expense' },
        });
      }
    }
    for (const e of ledgerEntries ?? []) {
      const customerName = nameById.get(e.customer_id) ?? 'Unknown customer';
      if (kind === 'received' && e.entry_type === 'credit') {
        list.push({
          id: e.id,
          date: e.entry_date ?? e.created_at,
          amount: e.amount,
          party: customerName,
          note: e.note ?? '',
          type: e.source === 'booking' ? PILL.jobPayment : PILL.paymentReceived,
          nav: { kind: 'party', partyId: e.customer_id },
        });
      }
      if (kind === 'paid' && e.entry_type === 'debit' && e.source === 'manual') {
        list.push({
          id: e.id,
          date: e.entry_date ?? e.created_at,
          amount: e.amount,
          party: customerName,
          note: e.note ?? '',
          type: PILL.paymentOut,
          nav: { kind: 'party', partyId: e.customer_id },
        });
      }
    }
    if (kind === 'paid') {
      for (const e of vendorEntries ?? []) {
        if (e.entry_type === 'credit') {
          list.push({
            id: e.id,
            date: e.entry_date ?? e.created_at,
            amount: e.amount,
            party: nameById.get(e.vendor_id) ?? 'Unknown vendor',
            note: e.note ?? '',
            type: PILL.paidVendor,
            nav: { kind: 'party', partyId: e.vendor_id },
          });
        }
      }
    }
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, ledgerEntries, vendorEntries, nameById, categoryById, kind]);

  const yearEntries = useMemo(() => entries.filter((e) => new Date(e.date).getFullYear() === year), [entries, year]);

  const stats = useMemo(() => {
    const now = new Date();
    let total = 0;
    let thisMonth = 0;
    let largest = 0;
    for (const e of yearEntries) {
      total += e.amount;
      largest = Math.max(largest, e.amount);
      const d = new Date(e.date);
      if (d.getMonth() === now.getMonth()) thisMonth += e.amount;
    }
    return { total, thisMonth, largest };
  }, [yearEntries]);

  const chartData = useMemo(() => {
    const now = new Date();
    if (granularity === 'week') {
      const thisWeekStart = startOfWeek(now);
      const weeks = Array.from({ length: 12 }, (_, i) => new Date(thisWeekStart.getTime() - (11 - i) * 7 * DAY_MS));
      return weeks.map((weekStart) => {
        const start = weekStart.getTime();
        const end = start + 7 * DAY_MS;
        const value = entries
          .filter((e) => {
            const t = new Date(e.date).getTime();
            return t >= start && t < end;
          })
          .reduce((sum, e) => sum + e.amount, 0);
        return { label: toBsDayChartLabel(weekStart), value };
      });
    }
    // month: Jan-Dec of the current year
    return Array.from({ length: 12 }, (_, month) => {
      const start = new Date(year, month, 1).getTime();
      const end = new Date(year, month + 1, 1).getTime();
      const value = entries
        .filter((e) => {
          const t = new Date(e.date).getTime();
          return t >= start && t < end;
        })
        .reduce((sum, e) => sum + e.amount, 0);
      return { label: toBsMonthChartLabel(start), value };
    });
  }, [entries, granularity, year]);

  const open = (e: Entry) =>
    router.push(
      (e.nav.kind === 'transactions' ? `${basePath}/transactions?type=${e.nav.type}` : `${basePath}/customer/${e.nav.partyId}`) as never
    );

  const amountCell = (e: Entry) => (
    <Text className="text-[12.5px] font-bold" style={{ color: meta.color }} numberOfLines={1}>
      {money(e.amount)}
    </Text>
  );
  const chevron = () => <Ionicons name="chevron-forward" size={14} color="#D1D5DB" />;

  const detailsCell = (e: Entry, compact: boolean) => (
    <View style={{ minWidth: 0, gap: 2 }}>
      <Text className="text-[13px] font-medium text-gray-900" numberOfLines={1}>
        {e.party || e.type.label}
      </Text>
      {compact && <Pill text={e.type.label} color={e.type.color} bg={e.type.bg} />}
      {(!!e.note || compact) && (
        <Text className="text-[11px] text-gray-400" numberOfLines={1}>
          {[compact ? bsShortDate(e.date) : null, e.note].filter(Boolean).join(' · ')}
        </Text>
      )}
    </View>
  );

  const columns: BookColumn<Entry>[] = layout.full
    ? [
        { key: 'date', label: 'Date', width: 104, render: (e) => <Text className="text-[12.5px] text-gray-500">{bsShortDate(e.date)}</Text> },
        { key: 'details', label: 'Details', render: (e) => detailsCell(e, false) },
        { key: 'type', label: 'Type', width: 150, render: (e) => <Pill text={e.type.label} color={e.type.color} bg={e.type.bg} /> },
        { key: 'amount', label: 'Amount', width: 130, align: 'right', render: amountCell },
        { key: 'act', label: '', width: 34, align: 'right', render: chevron },
      ]
    : [
        { key: 'details', label: 'Details', render: (e) => detailsCell(e, true) },
        { key: 'amount', label: 'Amount', width: 96, align: 'right', render: amountCell },
        { key: 'act', label: '', width: 30, align: 'right', render: chevron },
      ];

  return (
    <BookPage wide={layout.wide}>
      {toolbar}

      <BookStats>
        <BookStat label={`${year} total`} value={`NPR ${money(stats.total)}`} color={meta.color} />
        <BookStat label="This month" value={`NPR ${money(stats.thisMonth)}`} color="#374151" />
        <BookStat label="Entries" value={String(yearEntries.length)} color="#374151" />
        <BookStat label="Largest" value={`NPR ${money(stats.largest)}`} color="#374151" />
      </BookStats>

      <View className="rounded-xl border border-gray-300 bg-white p-4">
        <Text className="mb-3 text-xs text-gray-400">{granularity === 'week' ? 'Last 12 weeks' : `${year}, by month`}</Text>
        <BarChart
          data={chartData}
          color={meta.color}
          selectedColor={meta.color}
          height={layout.wide ? 140 : 110}
          formatValue={(v) => `NPR ${Math.round(v).toLocaleString()}`}
          formatLabel={(label, i) => (granularity === 'week' ? (i % 3 === 0 ? label : null) : layout.wide || i % 2 === 0 ? label : null)}
        />
      </View>

      {yearEntries.length === 0 ? (
        <View className="items-center rounded-xl border border-gray-300 bg-white py-10">
          <Ionicons name="cash-outline" size={28} color="#D1D5DB" />
          <Text className="mt-2 text-gray-500">Nothing here yet.</Text>
        </View>
      ) : (
        <BookTable
          columns={columns}
          rows={yearEntries}
          rowKey={(e) => e.id}
          onRowPress={open}
          groupOf={(e) => bsMonthGroup(e.date)}
          footer={{
            label: `${yearEntries.length} ${yearEntries.length === 1 ? 'entry' : 'entries'} · Total`,
            cells: { amount: <Text className="text-[13px] font-extrabold" style={{ color: meta.color }}>{money(stats.total)}</Text> },
          }}
        />
      )}

      <Text className="px-1 text-[11.5px] leading-[17px] text-gray-400">
        Tap an entry to open it.{' '}
        {kind === 'received'
          ? "Only money actually collected counts here - a sale bill on credit shows up once the customer pays."
          : "Only money that actually left counts here - a purchase bill on credit shows up once you pay the vendor."}
      </Text>
    </BookPage>
  );
}
