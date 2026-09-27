// lib/components/finance/FinanceDashboardScreen.tsx
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { useAccountBalances, isSettledOnTheSpot } from '../../hooks/useAccountBalances';
import { periodBuckets, type Granularity } from './TrendChartCard';
import { toBsDayChartLabel } from '../../utils/nepaliDate';
import { WEB_SIDEBAR_MIN_WIDTH } from '../web/WebSidebarShell';

const BLUE = '#2563EB';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Epoch ms for a bill/entry date. A bare 'YYYY-MM-DD' is read as local
 * midnight (new Date() would read it as UTC midnight); a full timestamp
 * (the created_at fallback) is used as-is. */
function dayTime(date: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return new Date(date).getTime();
}

// Cashflow's own "week" means the last 7 individual days, not an 8-week
// rolling aggregate like the shared periodBuckets('week', ...) other charts
// use - a reseller checking cashflow wants to see each day's activity, not
// one bar per calendar week.
function last7DayBuckets(): { start: number; end: number; label: string }[] {
  const now = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getTime() - (6 - i) * DAY_MS);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return { start, end: start + DAY_MS, label: toBsDayChartLabel(d) };
  });
}

function CircularProgress({
  percent,
  size = 44,
  strokeWidth = 4,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - percent / 100);
  return (
    <Svg width={size} height={size}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="rgba(255,255,255,0.3)"
        strokeWidth={strokeWidth}
        fill="none"
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="white"
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}

export function shortcuts(basePath: string): {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: string;
}[] {
  return [
    { key: 'daybook', label: 'Day Book', icon: 'book', href: `${basePath}/daybook` },
    { key: 'customers', label: 'Ledger', icon: 'people', href: `${basePath}/customers` },
    { key: 'payment-in', label: 'Received', icon: 'arrow-down-circle', href: `${basePath}/quick-payment?type=in` },
    { key: 'payment-out', label: 'Payment Out', icon: 'arrow-up-circle', href: `${basePath}/quick-payment?type=out` },
    { key: 'sales', label: 'Sales', icon: 'trending-up', href: `${basePath}/transactions?type=sale&add=1` },
    { key: 'purchase', label: 'Purchase', icon: 'cart', href: `${basePath}/transactions?type=purchase&add=1` },
    { key: 'expenses', label: 'Expenses', icon: 'receipt', href: `${basePath}/transactions?type=expense&add=1` },
    { key: 'bank-accounts', label: 'Bank Accounts', icon: 'business', href: `${basePath}/bank-accounts` },
    { key: 'import-statement', label: 'Import Statement', icon: 'document-attach', href: `${basePath}/import-statement` },
    { key: 'inventory', label: 'Inventory', icon: 'cube', href: `${basePath}/inventory` },
    { key: 'report', label: 'Report', icon: 'bar-chart', href: `${basePath}/report` },
    // Quotation generation only exists under (reseller) for now - a
    // wholesaler basePath has no matching route, so this would be a dead
    // link there.
    ...(basePath === '/(reseller)'
      ? [{ key: 'quotation', label: 'Quotation', icon: 'document-text' as const, href: `${basePath}/quotation/new` }]
      : []),
  ];
}

// Purely a rendering hint (icon badge color per shortcut) - not part of the
// shortcuts() data/routing above, so restyling the grid can never touch the
// key/label/icon/href it returns.
const SHORTCUT_COLORS: Record<string, { bg: string; fg: string }> = {
  daybook: { bg: '#EFF6FF', fg: '#1D4ED8' },
  customers: { bg: '#EFF6FF', fg: '#2563EB' },
  'payment-in': { bg: '#ECFDF5', fg: '#059669' },
  'payment-out': { bg: '#FEF2F2', fg: '#DC2626' },
  sales: { bg: '#ECFDF5', fg: '#059669' },
  purchase: { bg: '#FEF2F2', fg: '#DC2626' },
  expenses: { bg: '#FFFBEB', fg: '#D97706' },
  'bank-accounts': { bg: '#EEF2FF', fg: '#4F46E5' },
  'import-statement': { bg: '#F0FDFA', fg: '#0D9488' },
  inventory: { bg: '#F5F3FF', fg: '#7C3AED' },
  report: { bg: '#EFF6FF', fg: '#2563EB' },
  quotation: { bg: '#FDF4FF', fg: '#A21CAF' },
};

const CARD_SHADOW = {
  shadowColor: '#101828',
  shadowOpacity: 0.06,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

// Shows both cash IN and cash OUT for each day, side by side - a net-only
// bar can hide real volume (e.g. a big payment in and a big payment out the
// same day would net to ~zero and look like nothing happened).
function CashflowChart({
  data,
  formatLabel,
}: {
  data: { label: string; inAmt: number; outAmt: number }[];
  formatLabel?: (label: string, index: number) => string | null;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  // Switching granularity (e.g. Day -> Month) swaps in a shorter `data`
  // array - a selected index from the old, longer array would otherwise
  // point past the end of the new one and crash on data[selected].label.
  useEffect(() => {
    setSelected(null);
  }, [data]);
  const HEIGHT = 110;
  const maxAmt = Math.max(1, ...data.map((d) => Math.max(d.inAmt, d.outAmt)));

  return (
    <View>
      <View className="flex-row items-end" style={{ height: HEIGHT, gap: 8 }}>
        {data.map((d, i) => {
          const inHeight = d.inAmt > 0 ? Math.max(3, (d.inAmt / maxAmt) * HEIGHT) : 0;
          const outHeight = d.outAmt > 0 ? Math.max(3, (d.outAmt / maxAmt) * HEIGHT) : 0;
          const isSelected = selected === i;
          return (
            <Pressable
              key={i}
              onPress={() => setSelected(isSelected ? null : i)}
              className="flex-1 flex-row items-end justify-center"
              style={{ height: HEIGHT, gap: 3 }}
            >
              <View
                style={{ height: inHeight, backgroundColor: isSelected ? '#059669' : '#6ee7b7' }}
                className="flex-1 rounded-t"
              />
              <View
                style={{ height: outHeight, backgroundColor: isSelected ? '#dc2626' : '#fca5a5' }}
                className="flex-1 rounded-t"
              />
            </Pressable>
          );
        })}
      </View>
      <View className="mt-1.5 flex-row" style={{ gap: 8 }}>
        {data.map((d, i) => {
          const label = formatLabel ? formatLabel(d.label, i) : d.label;
          return (
            <View key={i} className="flex-1 items-center">
              {label ? (
                <Text className="text-[9px] text-gray-400" numberOfLines={1}>
                  {label}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
      {selected != null && data[selected] && (
        <View className="mt-2.5 self-start rounded-lg bg-gray-900 px-3 py-1.5">
          <Text className="text-xs font-semibold text-white">
            {data[selected].label}: In NPR {Math.round(data[selected].inAmt).toLocaleString()} · Out NPR{' '}
            {Math.round(data[selected].outAmt).toLocaleString()}
          </Text>
        </View>
      )}
      <View className="mt-2.5 flex-row items-center gap-4">
        <View className="flex-row items-center gap-1.5">
          <View className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
          <Text className="text-[11px] text-gray-500">Cash in</Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <View className="h-2.5 w-2.5 rounded-full bg-red-300" />
          <Text className="text-[11px] text-gray-500">Cash out</Text>
        </View>
      </View>
    </View>
  );
}

export function FinanceDashboardScreen({ basePath }: { basePath: string }) {
  const isReseller = basePath === '/(reseller)';
  // Percentage widths (e.g. '31%') combined with a flex `gap` are computed
  // differently by React Native's native layout engine than by the browser,
  // so 3-across tiles that render correctly on web can wrap to 2 on a real
  // device. Computing an exact pixel width up front avoids that mismatch.
  const { width: screenWidth } = useWindowDimensions();
  const SCREEN_PADDING = 24; // px-6
  const GRID_GAP = 12; // gap-3
  const thirdTileWidth = (screenWidth - SCREEN_PADDING * 2 - GRID_GAP * 2) / 3;
  // On web this screen renders inside WebSidebarShell's content column, not
  // the full browser window - a first attempt guessed that column's width
  // from useWindowDimensions (screen width minus an assumed sidebar width,
  // capped at the shell's max-width), but that guess didn't match the
  // column's true rendered width, so 5-across tiles only fit 4 per row. A
  // CSS calc() width sized against the tile's actual parent (100%) rather
  // than a guessed screen width fixes that, and works regardless of how
  // wide the sidebar/content column end up being.
  const webTileWidth = (columns: number) => `calc((100% - ${GRID_GAP * (columns - 1)}px) / ${columns})` as unknown as number;
  const userId = useAuthStore((state) => state.session?.user.id);
  const profile = useAuthStore((state) => state.profile);
  const { data: customers } = useSupabaseQuery('customers', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { data: allEntries } = useSupabaseQuery('customer_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { data: vendorEntries } = useSupabaseQuery('vendor_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { data: transactions } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });

  const totals = useMemo(() => {
    const result = { sale: 0, purchase: 0, expense: 0 };
    for (const t of transactions ?? []) {
      result[t.type] += t.amount;
    }
    return result;
  }, [transactions]);

  // To Receive = customers who owe the business (customer_ledger_entries).
  // To Give = vendors the business owes (vendor_ledger_entries) - a
  // separate ledger with the opposite polarity, so a customer overpayment
  // never gets misread as a supplier debt and vice versa.
  const toReceive = useMemo(() => {
    const perCustomer: Record<string, number> = {};
    for (const e of allEntries ?? []) {
      perCustomer[e.customer_id] = (perCustomer[e.customer_id] ?? 0) + (e.entry_type === 'debit' ? e.amount : -e.amount);
    }
    return Object.values(perCustomer)
      .filter((balance) => balance > 0)
      .reduce((sum, balance) => sum + balance, 0);
  }, [allEntries]);

  const toGive = useMemo(() => {
    const perVendor: Record<string, number> = {};
    for (const e of vendorEntries ?? []) {
      perVendor[e.vendor_id] = (perVendor[e.vendor_id] ?? 0) + (e.entry_type === 'debit' ? e.amount : -e.amount);
    }
    return Object.values(perVendor)
      .filter((balance) => balance > 0)
      .reduce((sum, balance) => sum + balance, 0);
  }, [vendorEntries]);

  const [cashflowGranularity, setCashflowGranularity] = useState<Granularity>('week');
  // "Week" = the last 7 individual days (last7DayBuckets, above) rather than
  // an 8-week rolling aggregate - a reseller checking cashflow wants each
  // day's activity, not one bar per calendar week. "Month" still uses the
  // shared monthly buckets; 6 of them (not 12) since each bucket here
  // renders two bars (in + out) side by side and needs roughly half as many
  // buckets as a single-bar chart to stay readable on a phone screen.
  const cashflowBuckets = useMemo(
    () => (cashflowGranularity === 'week' ? last7DayBuckets() : periodBuckets('month', 6)),
    [cashflowGranularity]
  );

  // Same "received"/"paid" definition as yearReceived/yearPaid below - real
  // cash in is any payment collected (ledger credits); real cash out is
  // expenses, manual Payment Out entries, and payments made to a vendor.
  // Sale/Purchase don't move cash by themselves any more - each one books a
  // debt on the party's ledger instead (0061_sale_purchase_always_ledger.sql),
  // and it's that ledger being settled that actually shows up as cash here.
  const cashflow = useMemo(() => {
    return cashflowBuckets.map((b) => {
      // Bucketed by the date the entry is FOR (bill/entry date), the same
      // as the Totals report and Day Book - created_at put back-dated
      // entries in a different period here than on those screens.
      const inBucket = (date: string) => {
        const t = dayTime(date);
        return t >= b.start && t < b.end;
      };
      const bucketTx = (transactions ?? []).filter((t) => inBucket(t.bill_date ?? t.created_at));
      const bucketEntries = (allEntries ?? []).filter((e) => inBucket(e.entry_date ?? e.created_at));
      const bucketVendorEntries = (vendorEntries ?? []).filter((e) => inBucket(e.entry_date ?? e.created_at));
      const inAmt =
        bucketEntries.filter((e) => e.entry_type === 'credit').reduce((sum, e) => sum + e.amount, 0) +
        bucketTx.filter((t) => isSettledOnTheSpot(t) && t.type === 'sale').reduce((sum, t) => sum + t.amount, 0);
      const outAmt =
        bucketTx.filter((t) => isSettledOnTheSpot(t) && t.type === 'purchase').reduce((sum, t) => sum + t.amount, 0) +
        bucketTx.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0) +
        bucketEntries.filter((e) => e.entry_type === 'debit' && e.source === 'manual').reduce((sum, e) => sum + e.amount, 0) +
        bucketVendorEntries.filter((e) => e.entry_type === 'credit').reduce((sum, e) => sum + e.amount, 0);
      return { label: b.label, inAmt, outAmt };
    });
  }, [transactions, allEntries, vendorEntries, cashflowBuckets]);

  // The combined cash-in-hand + bank balance across every account - shared
  // with the Bank Accounts screen's per-account breakdown so the two can
  // never drift apart (see useAccountBalances for the full formula).
  const accountBalances = useAccountBalances(userId);
  const availableBalance = accountBalances.total;

  // Matches TotalsReportScreen's definitions: "received" is a payment
  // actually collected from a customer (Payment In, or a synced job
  // payment) - NOT a Sale, which is its own separate figure (the Sales
  // tile above) and, since 0061_sale_purchase_always_ledger.sql, books a
  // debt rather than cash received. "paid" is every expense, every manual
  // Payment Out to a customer, and every payment actually made to a vendor
  // (a Purchase itself is a debt too now, not cash spent) - booking-sourced
  // debit entries are excluded since those represent money owed, not money
  // that's actually left the business yet.
  const { yearReceived, yearPaid } = useMemo(() => {
    const year = new Date().getFullYear();
    let received = 0;
    let paid = 0;
    const inYear = (date: string) => new Date(dayTime(date)).getFullYear() === year;
    for (const t of transactions ?? []) {
      if (!inYear(t.bill_date ?? t.created_at)) continue;
      if (t.type === 'expense') paid += t.amount;
      if (isSettledOnTheSpot(t)) {
        if (t.type === 'sale') received += t.amount;
        else paid += t.amount;
      }
    }
    for (const e of allEntries ?? []) {
      if (!inYear(e.entry_date ?? e.created_at)) continue;
      if (e.entry_type === 'credit') received += e.amount;
      if (e.entry_type === 'debit' && e.source === 'manual') paid += e.amount;
    }
    for (const e of vendorEntries ?? []) {
      if (!inYear(e.entry_date ?? e.created_at)) continue;
      if (e.entry_type === 'credit') paid += e.amount;
    }
    return { yearReceived: received, yearPaid: paid };
  }, [transactions, allEntries, vendorEntries]);

  const profileCompletion = useMemo(() => {
    const fields = [profile?.full_name, profile?.phone, profile?.avatar_url, profile?.city];
    const filled = fields.filter(Boolean).length;
    return Math.round((filled / fields.length) * 100);
  }, [profile]);

  const heroCard = (
    <LinearGradient
      colors={['#2563EB', '#1D4ED8']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        borderRadius: 24,
        padding: 20,
        gap: 16,
        marginBottom: 12,
        shadowColor: '#2563EB',
        shadowOpacity: 0.35,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 6,
      }}
    >
      <Pressable onPress={() => router.push(`${basePath}/bank-balances` as any)}>
        <Text className="text-xs font-bold text-white/75" style={{ letterSpacing: 0.5 }}>
          AVAILABLE BALANCE
        </Text>
        <Text className="mt-1 text-3xl font-extrabold text-white">NPR {availableBalance.toLocaleString()}</Text>
      </Pressable>

      <View className="flex-row gap-2.5">
        <Pressable
          onPress={() => router.push(`${basePath}/to-receive` as any)}
          className="flex-1 rounded-2xl p-3"
          style={{ backgroundColor: 'rgba(255,255,255,0.14)' }}
        >
          <View className="flex-row items-center gap-1.5">
            <View className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            <Text className="text-[11px] font-semibold text-white/85">To Receive</Text>
          </View>
          <Text className="mt-0.5 text-sm font-extrabold text-white">NPR {toReceive.toLocaleString()}</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push(`${basePath}/to-give` as any)}
          className="flex-1 rounded-2xl p-3"
          style={{ backgroundColor: 'rgba(255,255,255,0.14)' }}
        >
          <View className="flex-row items-center gap-1.5">
            <View className="h-1.5 w-1.5 rounded-full bg-red-300" />
            <Text className="text-[11px] font-semibold text-white/85">To Give</Text>
          </View>
          <Text className="mt-0.5 text-sm font-extrabold text-white">NPR {toGive.toLocaleString()}</Text>
        </Pressable>
      </View>

      <View className="flex-row gap-2.5">
        <Pressable
          onPress={() => router.push(`${basePath}/transactions` as any)}
          className="flex-1 flex-row items-center justify-center gap-1.5 rounded-full py-2.5"
          style={{ backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' }}
        >
          <Ionicons name="list-outline" size={15} color="white" />
          <Text className="text-[13px] font-semibold text-white" numberOfLines={1}>
            Transactions
          </Text>
        </Pressable>
        {isReseller && (
          <Pressable
            onPress={() => router.push(`${basePath}/wholesale` as any)}
            className="flex-1 flex-row items-center justify-center gap-1.5 rounded-full bg-white py-2.5"
          >
            <Ionicons name="cart-outline" size={15} color={BLUE} />
            <Text className="text-[13px] font-semibold" style={{ color: BLUE }} numberOfLines={1}>
              Buy Stock
            </Text>
          </Pressable>
        )}
      </View>
    </LinearGradient>
  );

  const profileCompletionCard = profileCompletion < 100 && (
    <Pressable onPress={() => router.push(`${basePath}/profile` as any)} className="mb-4 overflow-hidden rounded-2xl">
      <LinearGradient
        colors={['#2563EB', '#1D4ED8']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}
      >
        <View style={{ width: 44, height: 44 }} className="items-center justify-center">
          <View style={{ position: 'absolute' }}>
            <CircularProgress percent={profileCompletion} />
          </View>
          <Text className="text-xs font-extrabold text-white">{profileCompletion}%</Text>
        </View>
        <View className="flex-1">
          <Text className="text-sm font-bold text-white">Complete your profile</Text>
          <Text className="mt-0.5 text-xs text-white/80">
            Add your remaining details so customers and technicians trust your business.
          </Text>
        </View>
        <Ionicons name="arrow-forward" size={18} color="white" />
      </LinearGradient>
    </Pressable>
  );

  const cashflowCard = (
    <View className="mb-4 rounded-2xl bg-white p-4" style={CARD_SHADOW}>
      <Text className="mb-3 text-sm font-semibold text-gray-900">Cashflow</Text>
      <View className="mb-3 flex-row gap-2">
        {(['week', 'month'] as Granularity[]).map((g) => {
          const selectedG = cashflowGranularity === g;
          return (
            <Pressable
              key={g}
              onPress={() => setCashflowGranularity(g)}
              className={`flex-1 items-center rounded-full py-1.5 ${selectedG ? '' : 'border border-gray-200 bg-white'}`}
              style={selectedG ? { backgroundColor: BLUE } : undefined}
            >
              <Text className={`text-xs font-semibold capitalize ${selectedG ? 'text-white' : 'text-gray-600'}`}>{g}</Text>
            </Pressable>
          );
        })}
      </View>
      {/* Only ever 7 (week) or 6 (month) buckets here - few enough to
          always show every label, unlike the sparser 8-12 bucket charts
          elsewhere that need to skip some to avoid crowding. */}
      <CashflowChart data={cashflow} formatLabel={(label) => label} />
    </View>
  );

  const footerText = (
    <Text className="text-center text-xs text-gray-400">
      Across {customers?.length ?? 0} customer{(customers?.length ?? 0) === 1 ? '' : 's'}
    </Text>
  );

  // A phone browser hitting the website is still "web" (Platform.OS ===
  // 'web'), but cramming a 5-across desktop grid into a ~360-400px phone
  // viewport is just as broken as the sidebar was there - this only kicks
  // in wide enough for it to actually make sense (matches the sidebar's own
  // breakpoint in WebSidebarShell, since that's the layout this screen
  // normally renders inside once it's wide enough to show at all).
  if (Platform.OS === 'web' && screenWidth >= WEB_SIDEBAR_MIN_WIDTH) {
    // Sales/Purchase/Expense and Total Received/Total Paid were two
    // separate rows (3 then 2) stacked vertically - on a laptop that's
    // just wasted height for no reason, so combine all 5 into one row.
    // They land at exactly 5-across since webTileWidth(5) sizes each card
    // as a fifth of the row, which conveniently also matches the
    // "Received"/"Paid" pair, so nothing needs its own leftover 2-wide row.
    const webStatCards: {
      key: string;
      label: string;
      value: number;
      icon: keyof typeof Ionicons.glyphMap;
      bg: string;
      fg: string;
      href: string;
    }[] = [
      { key: 'sales', label: 'Sales', value: totals.sale, icon: 'trending-up', bg: '#ECFDF5', fg: '#059669', href: `${basePath}/transactions?type=sale` },
      { key: 'purchase', label: 'Purchase', value: totals.purchase, icon: 'cart', bg: '#FEF2F2', fg: '#DC2626', href: `${basePath}/transactions?type=purchase` },
      { key: 'expense', label: 'Expense', value: totals.expense, icon: 'receipt', bg: '#FFFBEB', fg: '#D97706', href: `${basePath}/transactions?type=expense` },
      { key: 'received', label: 'Total Received', value: yearReceived, icon: 'arrow-down-circle', bg: '#ECFDF5', fg: '#059669', href: `${basePath}/received` },
      { key: 'paid', label: 'Total Paid', value: yearPaid, icon: 'arrow-up-circle', bg: '#FEF2F2', fg: '#DC2626', href: `${basePath}/paid` },
    ];

    return (
      <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 24 }}>
        {heroCard}

        <View className="mb-3 flex-row flex-wrap" style={{ gap: GRID_GAP }}>
          {webStatCards.map((s) => (
            <Pressable
              key={s.key}
              onPress={() => router.push(s.href as any)}
              className="rounded-2xl bg-white p-3.5"
              style={{ width: webTileWidth(5), ...CARD_SHADOW }}
            >
              <View className="mb-2 h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: s.bg }}>
                <Ionicons name={s.icon} size={16} color={s.fg} />
              </View>
              <Text className="text-xs font-semibold text-gray-500" numberOfLines={1}>
                {s.label}
              </Text>
              <Text className="mt-0.5 text-sm font-extrabold" style={{ color: s.fg }} numberOfLines={1}>
                NPR {s.value.toLocaleString()}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* 10 shortcuts at a 5-column tile width lands as a literal 5x2
            grid instead of wrapping down to a single narrow column the
            way the native (screen-width-based) tile size did here. */}
        <Text className="mb-2 text-sm font-semibold text-gray-900">Shortcuts</Text>
        <View className="mb-4 flex-row flex-wrap" style={{ gap: GRID_GAP }}>
          {shortcuts(basePath).map((s) => {
            const color = SHORTCUT_COLORS[s.key] ?? { bg: '#EFF6FF', fg: BLUE };
            return (
              <Pressable
                key={s.key}
                onPress={() => router.push(s.href as any)}
                className="items-center rounded-2xl bg-white py-4"
                style={{ width: webTileWidth(5), ...CARD_SHADOW }}
              >
                <View className="mb-1.5 h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: color.bg }}>
                  <Ionicons name={s.icon} size={22} color={color.fg} />
                </View>
                <Text className="text-center text-xs font-semibold text-gray-700">{s.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {profileCompletionCard}
        {cashflowCard}
        {footerText}
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
      {heroCard}

      {/* Sales is money in (green); Purchase and Expense are money spent
          (red), regardless of the actual figure's sign. Available Balance
          moved into the hero above - same value, same route, just shown
          once, big, instead of duplicated in a small tile here. */}
      <View className="mb-3 flex-row flex-wrap gap-3">
        <Pressable
          onPress={() => router.push(`${basePath}/transactions?type=sale` as any)}
          className="rounded-2xl bg-white p-3.5"
          style={{ width: thirdTileWidth, ...CARD_SHADOW }}
        >
          <View className="mb-2 h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
            <Ionicons name="trending-up" size={16} color="#059669" />
          </View>
          <Text className="text-xs font-semibold text-gray-500">Sales</Text>
          <Text className="mt-0.5 text-sm font-extrabold text-emerald-600">NPR {totals.sale.toLocaleString()}</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push(`${basePath}/transactions?type=purchase` as any)}
          className="rounded-2xl bg-white p-3.5"
          style={{ width: thirdTileWidth, ...CARD_SHADOW }}
        >
          <View className="mb-2 h-8 w-8 items-center justify-center rounded-lg bg-red-50">
            <Ionicons name="cart" size={16} color="#DC2626" />
          </View>
          <Text className="text-xs font-semibold text-gray-500">Purchase</Text>
          <Text className="mt-0.5 text-sm font-extrabold text-red-600">NPR {totals.purchase.toLocaleString()}</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push(`${basePath}/transactions?type=expense` as any)}
          className="rounded-2xl bg-white p-3.5"
          style={{ width: thirdTileWidth, ...CARD_SHADOW }}
        >
          <View className="mb-2 h-8 w-8 items-center justify-center rounded-lg bg-amber-50">
            <Ionicons name="receipt" size={16} color="#D97706" />
          </View>
          <Text className="text-xs font-semibold text-gray-500">Expense</Text>
          <Text className="mt-0.5 text-sm font-extrabold text-amber-600">NPR {totals.expense.toLocaleString()}</Text>
        </Pressable>
      </View>

      <View className="mb-3 flex-row gap-3">
        <Pressable
          onPress={() => router.push(`${basePath}/received` as any)}
          className="flex-1 flex-row items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5"
        >
          <View className="h-9 w-9 items-center justify-center rounded-full bg-white">
            <Ionicons name="arrow-down-circle" size={18} color="#059669" />
          </View>
          <View className="flex-1">
            <Text className="text-xs font-semibold text-emerald-700">Total Received</Text>
            <Text className="mt-0.5 text-sm font-extrabold text-emerald-700">NPR {yearReceived.toLocaleString()}</Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => router.push(`${basePath}/paid` as any)}
          className="flex-1 flex-row items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-3.5"
        >
          <View className="h-9 w-9 items-center justify-center rounded-full bg-white">
            <Ionicons name="arrow-up-circle" size={18} color="#DC2626" />
          </View>
          <View className="flex-1">
            <Text className="text-xs font-semibold text-red-600">Total Paid</Text>
            <Text className="mt-0.5 text-sm font-extrabold text-red-600">NPR {yearPaid.toLocaleString()}</Text>
          </View>
        </Pressable>
      </View>

      <Text className="mb-2 text-sm font-semibold text-gray-900">Shortcuts</Text>
      <View className="mb-4 flex-row flex-wrap gap-3">
        {shortcuts(basePath).map((s) => {
          const color = SHORTCUT_COLORS[s.key] ?? { bg: '#EFF6FF', fg: BLUE };
          return (
            <Pressable
              key={s.key}
              onPress={() => router.push(s.href as any)}
              className="items-center rounded-2xl bg-white py-4"
              style={{ width: thirdTileWidth, ...CARD_SHADOW }}
            >
              <View className="mb-1.5 h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: color.bg }}>
                <Ionicons name={s.icon} size={22} color={color.fg} />
              </View>
              <Text className="text-center text-xs font-semibold text-gray-700">{s.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {profileCompletionCard}
      {cashflowCard}
      {footerText}
    </ScrollView>
  );
}
