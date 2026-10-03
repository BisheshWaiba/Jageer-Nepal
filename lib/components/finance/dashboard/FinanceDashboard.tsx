// lib/components/finance/dashboard/FinanceDashboard.tsx
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../../hooks/useAuth';
import { useSupabaseQuery } from '../../../hooks/useSupabase';
import { toBsHistoryLabel } from '../../../utils/nepaliDate';
import { LineChart } from './LineChart';
import { MONEY } from '../moneyColors';
import { PERIODS, buildRange, npr, seriesByBucket, sumType, txTime, type PeriodKey } from './dashboardData';

const SALES = MONEY.in.base;
const PURCHASE = MONEY.out.base;
const EXPENSE = MONEY.out.base;

export const CARD_SHADOW = {
  shadowColor: '#101828',
  shadowOpacity: 0.06,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

/** The one card every block on the Finance page uses: white, 16px radius, 20px
 * padding, a 15px title with an optional caption, and it stretches to the
 * height of its row so neighbours always end on the same line. */
export function Card({
  title,
  subtitle,
  right,
  children,
  style,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View className="rounded-2xl bg-white p-5" style={[CARD_SHADOW, { flexGrow: 1 }, style]}>
      <View className="mb-4 flex-row flex-wrap items-start justify-between" style={{ gap: 12 }}>
        <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 150 }}>
          <Text className="text-[15px] font-bold text-gray-900">{title}</Text>
          {!!subtitle && <Text className="mt-0.5 text-xs text-gray-400">{subtitle}</Text>}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

const TYPE_STYLE = {
  sale: { icon: 'trending-up', color: SALES, label: 'Sale' },
  purchase: { icon: 'cart', color: PURCHASE, label: 'Purchase' },
  expense: { icon: 'receipt', color: EXPENSE, label: 'Expense' },
} as const;

function useTransactions() {
  const userId = useAuthStore((state) => state.session?.user.id);
  const { data } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  return useMemo(() => data ?? [], [data]);
}

/** Sales over time as a line, with a 7 days / 30 days / 6 months / 12 months switch. */
export function SalesTrendCard() {
  const txs = useTransactions();
  const [period, setPeriod] = useState<PeriodKey>('1m');

  const range = useMemo(() => buildRange(period), [period]);
  const labels = useMemo(() => range.buckets.map((b) => b.label), [range]);
  const periodMeta = PERIODS.find((p) => p.key === period)!;
  // Today by the hour stops at the current hour rather than running down to zero.
  const sales = useMemo(() => seriesByBucket(txs, 'sale', range.buckets).slice(0, range.upTo), [txs, range]);
  const salesTotal = useMemo(() => sumType(txs, 'sale', range.from, range.to), [txs, range]);

  return (
    <Card
      title="Sales trend"
      subtitle={`${npr(salesTotal)} ${periodMeta.caption}`}
      right={
        <View className="flex-row rounded-xl bg-gray-100 p-1" style={{ gap: 2 }}>
          {PERIODS.map((p) => {
            const on = p.key === period;
            return (
              <Pressable
                key={p.key}
                onPress={() => setPeriod(p.key)}
                className="rounded-lg px-3 py-1.5"
                style={on ? { backgroundColor: '#fff', ...CARD_SHADOW, shadowOpacity: 0.1 } : undefined}
              >
                <Text className={`text-xs font-bold ${on ? 'text-blue-600' : 'text-gray-500'}`}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>
      }
    >
      <LineChart
        labels={labels}
        series={[{ key: 'sale', label: 'Sales', color: SALES, values: sales, area: true }]}
        height={270}
        formatValue={npr}
        emptyText="No sales recorded in this period yet"
      />
    </Card>
  );
}

/** The latest sales, purchases and expenses, newest first. */
export function RecentActivityCard({ basePath }: { basePath: string }) {
  const txs = useTransactions();
  const recent = useMemo(
    () => [...txs].sort((a, b) => txTime(b) - txTime(a) || b.created_at.localeCompare(a.created_at)).slice(0, 6),
    [txs]
  );
  const go = (path: string) => router.push(`${basePath}${path}` as never);

  return (
    <Card
      title="Recent activity"
      subtitle="Latest sales, purchases and expenses"
      right={
        <Pressable onPress={() => go('/transactions')}>
          <Text className="text-xs font-bold text-blue-600">View all</Text>
        </Pressable>
      }
    >
      {recent.length === 0 ? (
        <View className="items-center justify-center py-10">
          <Text className="text-center text-sm text-gray-400">Nothing recorded yet</Text>
        </View>
      ) : (
        <View>
          {recent.map((t, i) => {
            const meta = TYPE_STYLE[t.type];
            return (
              <Pressable
                key={t.id}
                onPress={() => go(`/transactions?type=${t.type}`)}
                className={`flex-row items-center justify-between py-2.5 ${i < recent.length - 1 ? 'border-b border-gray-100' : ''}`}
                style={{ gap: 10 }}
              >
                <View className="flex-1 flex-row items-center" style={{ gap: 10, minWidth: 0 }}>
                  <View className="h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${meta.color}1A` }}>
                    <Ionicons name={meta.icon} size={14} color={meta.color} />
                  </View>
                  <View className="flex-1" style={{ minWidth: 0 }}>
                    <Text className="text-[13px] font-semibold text-gray-900" numberOfLines={1}>
                      {t.party_name || meta.label}
                    </Text>
                    <Text className="text-[11px] text-gray-400" numberOfLines={1}>
                      {toBsHistoryLabel(t.bill_date ?? t.created_at)}
                    </Text>
                  </View>
                </View>
                <Text className="text-[13px] font-bold" style={{ color: meta.color }} numberOfLines={1}>
                  {t.type === 'sale' ? '+' : '−'} {npr(t.amount)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </Card>
  );
}
