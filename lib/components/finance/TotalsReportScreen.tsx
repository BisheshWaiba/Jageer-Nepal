// lib/components/finance/TotalsReportScreen.tsx
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { isSettledOnTheSpot } from '../../hooks/useAccountBalances';
import { toBsDayChartLabel, toBsHistoryLabel, toBsMonthChartLabel } from '../../utils/nepaliDate';
import { BarChart } from '../BarChart';

const DAY_MS = 24 * 60 * 60 * 1000;

type Kind = 'received' | 'paid';
type Granularity = 'week' | 'month';

type NavTarget = { kind: 'transactions'; type: 'expense' | 'sale' | 'purchase' } | { kind: 'party'; partyId: string };

interface Entry {
  id: string;
  date: string;
  amount: number;
  label: string;
  sub: string;
  nav: NavTarget;
}

const KIND_META: Record<Kind, { title: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  received: { title: 'Total Received', color: '#059669', bg: '#ECFDF5', icon: 'arrow-down-circle' },
  paid: { title: 'Total Paid', color: '#DC2626', bg: '#FEF2F2', icon: 'arrow-up-circle' },
};

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfWeek(d: Date) {
  const day = startOfDay(d);
  const dow = day.getDay() === 0 ? 7 : day.getDay(); // Monday = 1 ... Sunday = 7
  return new Date(day.getTime() - (dow - 1) * DAY_MS);
}

export function TotalsReportScreen({ kind, basePath }: { kind: Kind; basePath: string }) {
  const meta = KIND_META[kind];
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
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    (customers ?? []).forEach((c) => map.set(c.id, c.name));
    return map;
  }, [customers]);

  const [granularity, setGranularity] = useState<Granularity>('month');
  const year = new Date().getFullYear();

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
          label: t.type === 'sale' ? 'Sale' : 'Purchase',
          sub: t.party_name ?? t.note ?? '',
          nav: { kind: 'transactions', type: t.type === 'sale' ? 'sale' : 'purchase' },
        });
      }
      if (kind === 'paid' && t.type === 'expense') {
        list.push({
          id: t.id,
          date: t.bill_date ?? t.created_at,
          amount: t.amount,
          label: 'Expense',
          sub: t.party_name ?? t.note ?? '',
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
          label: `${e.source === 'booking' ? 'Job payment' : 'Payment received'} · ${customerName}`,
          sub: e.note ?? '',
          nav: { kind: 'party', partyId: e.customer_id },
        });
      }
      if (kind === 'paid' && e.entry_type === 'debit' && e.source === 'manual') {
        list.push({
          id: e.id,
          date: e.entry_date ?? e.created_at,
          amount: e.amount,
          label: `Payment out · ${customerName}`,
          sub: e.note ?? '',
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
            label: `Paid vendor · ${nameById.get(e.vendor_id) ?? 'Unknown vendor'}`,
            sub: e.note ?? '',
            nav: { kind: 'party', partyId: e.vendor_id },
          });
        }
      }
    }
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, ledgerEntries, vendorEntries, nameById, kind]);

  const yearTotal = useMemo(
    () => entries.filter((e) => new Date(e.date).getFullYear() === year).reduce((sum, e) => sum + e.amount, 0),
    [entries, year]
  );

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

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
      <View className="mb-3 flex-row items-center gap-2">
        <Pressable onPress={() => router.back()} hitSlop={8} className="p-1">
          <Ionicons name="chevron-back" size={20} color="#374151" />
        </Pressable>
        <Text className="text-base font-bold text-gray-900">{meta.title}</Text>
      </View>

      <View className="mb-4 rounded-2xl p-4" style={{ backgroundColor: meta.bg }}>
        <View className="mb-1 flex-row items-center gap-2">
          <Ionicons name={meta.icon} size={16} color={meta.color} />
          <Text className="text-xs font-semibold" style={{ color: meta.color }}>
            {year} total
          </Text>
        </View>
        <Text className="text-2xl font-extrabold" style={{ color: meta.color }}>
          NPR {yearTotal.toLocaleString()}
        </Text>
      </View>

      <View className="mb-3 flex-row gap-2">
        {(['week', 'month'] as Granularity[]).map((g) => {
          const selected = granularity === g;
          return (
            <Pressable
              key={g}
              onPress={() => setGranularity(g)}
              className={`flex-1 items-center rounded-full py-2 ${selected ? '' : 'border border-gray-200 bg-white'}`}
              style={selected ? { backgroundColor: meta.color } : undefined}
            >
              <Text className={`text-xs font-semibold capitalize ${selected ? 'text-white' : 'text-gray-600'}`}>
                {g}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
        <Text className="mb-3 text-xs text-gray-400">
          {granularity === 'week' ? 'Last 12 weeks' : `${year}, by month`}
        </Text>
        <BarChart
          data={chartData}
          color={meta.color}
          selectedColor={meta.color}
          formatValue={(v) => `NPR ${Math.round(v).toLocaleString()}`}
          formatLabel={(label, i) => (granularity === 'week' ? (i % 3 === 0 ? label : null) : label)}
        />
      </View>

      <Text className="mb-2 text-sm font-semibold text-gray-900">{year} entries</Text>
      {entries.filter((e) => new Date(e.date).getFullYear() === year).length === 0 && (
        <View className="items-center rounded-2xl border border-dashed border-gray-200 bg-white py-10">
          <Ionicons name="cash-outline" size={28} color="#D1D5DB" />
          <Text className="mt-2 text-gray-500">Nothing here yet.</Text>
        </View>
      )}
      {entries
        .filter((e) => new Date(e.date).getFullYear() === year)
        .map((e) => (
          <Pressable
            key={e.id}
            onPress={() =>
              router.push(
                (e.nav.kind === 'transactions'
                  ? `${basePath}/transactions?type=${e.nav.type}`
                  : `${basePath}/customer/${e.nav.partyId}`) as any
              )
            }
            className="mb-2 flex-row items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3"
          >
            <View className="flex-1 pr-2">
              <Text className="text-sm font-semibold text-gray-900">{e.label}</Text>
              <Text className="text-xs text-gray-400" numberOfLines={1}>
                {[e.sub, toBsHistoryLabel(e.date)].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Text className="text-sm font-extrabold" style={{ color: meta.color }}>
              NPR {e.amount.toLocaleString()}
            </Text>
            <Ionicons name="chevron-forward" size={14} color="#D1D5DB" style={{ marginLeft: 6 }} />
          </Pressable>
        ))}
    </ScrollView>
  );
}
