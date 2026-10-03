// lib/components/finance/ReportScreen.tsx
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { useAccountBalances } from '../../hooks/useAccountBalances';
import { useBarActions, useBookLayout } from './BookKit';

type Period = 'month' | 'year' | 'all';

const PERIOD_LABEL: Record<Period, string> = { month: 'This Month', year: 'This Year', all: 'All Time' };

function Row({ label, value, color = '#111827', bold = false }: { label: string; value: number; color?: string; bold?: boolean }) {
  return (
    <View className="flex-row items-center justify-between py-2">
      <Text className={`text-sm ${bold ? 'font-bold text-gray-900' : 'text-gray-500'}`}>{label}</Text>
      <Text className={`text-sm ${bold ? 'font-extrabold' : 'font-semibold'}`} style={{ color }}>
        NPR {value.toLocaleString()}
      </Text>
    </View>
  );
}

/** A profit & loss summary pulled from the same Finance data as everywhere
 * else - Sales, Purchase, and Expense already carry their own bill date, so
 * this just re-sums them for whichever period is selected instead of
 * introducing a second source of truth. */
export function ReportScreen({ basePath }: { basePath: string }) {
  const userId = useAuthStore((state) => state.session?.user.id);
  const { data: transactions } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const balances = useAccountBalances(userId);
  const [period, setPeriod] = useState<Period>('month');

  const inRange = useMemo(() => {
    const now = new Date();
    return (transactions ?? []).filter((t) => {
      if (period === 'all') return true;
      const d = new Date(t.bill_date ?? t.created_at);
      if (period === 'year') return d.getFullYear() === now.getFullYear();
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
  }, [transactions, period]);

  const totals = useMemo(() => {
    const result = { sale: 0, purchase: 0, expense: 0 };
    for (const t of inRange) result[t.type] += t.amount;
    return result;
  }, [inRange]);

  const grossProfit = totals.sale - totals.purchase;
  const netProfit = grossProfit - totals.expense;

  // The name (and the back button on a phone) are in the top bar.
  const layout = useBookLayout();
  useBarActions({ wide: layout.wide }, []);

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
      <View className="mb-4 flex-row gap-2">
        {(['month', 'year', 'all'] as Period[]).map((p) => {
          const selected = period === p;
          return (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              className={`flex-1 items-center rounded-full py-2 ${selected ? 'bg-blue-600' : 'border border-gray-200 bg-white'}`}
            >
              <Text className={`text-xs font-semibold ${selected ? 'text-white' : 'text-gray-600'}`}>{PERIOD_LABEL[p]}</Text>
            </Pressable>
          );
        })}
      </View>

      <View className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
        <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Profit &amp; Loss</Text>
        <Row label="Sales" value={totals.sale} color="#059669" />
        <View className="border-t border-gray-100" />
        <Row label="Purchase" value={totals.purchase} color="#DC2626" />
        <View className="border-t border-gray-100" />
        <Row label="Gross Profit" value={grossProfit} color={grossProfit >= 0 ? '#059669' : '#DC2626'} bold />
        <View className="mt-1 border-t border-gray-200" />
        <Row label="Expense" value={totals.expense} color="#DC2626" />
        <View className="border-t border-gray-100" />
        <Row label="Net Profit" value={netProfit} color={netProfit >= 0 ? '#059669' : '#DC2626'} bold />
      </View>

      <View className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
        <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Cash Position (as of today)</Text>
        <Row label="Available Balance" value={balances.total} color={balances.total >= 0 ? '#2563EB' : '#DC2626'} bold />
      </View>

      <View className="flex-row gap-3">
        <Pressable
          onPress={() => router.push(`${basePath}/received` as any)}
          className="flex-1 items-center rounded-2xl border border-emerald-200 bg-emerald-50 py-3"
        >
          <Text className="text-xs font-semibold text-emerald-700">View Total Received →</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push(`${basePath}/paid` as any)}
          className="flex-1 items-center rounded-2xl border border-red-200 bg-red-50 py-3"
        >
          <Text className="text-xs font-semibold text-red-600">View Total Paid →</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
