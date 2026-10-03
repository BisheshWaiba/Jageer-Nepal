// lib/components/finance/FinanceDashboardScreen.tsx
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { useAccountBalances, isSettledOnTheSpot } from '../../hooks/useAccountBalances';
import { WEB_SIDEBAR_MIN_WIDTH } from '../web/WebSidebarShell';
import { MONEY, type MoneyTone } from './moneyColors';
import { CARD_SHADOW, Card, RecentActivityCard, SalesTrendCard } from './dashboard/FinanceDashboard';

const BLUE = '#2563EB';

/** Space between blocks, and the gutter around the page - one value, so the
 * rhythm is the same between cards as it is at the edges. */
const GAP = 24;
/** Below this the two columns stack. */
const TWO_COLUMN_MIN = 900;
/** Metric grid: three across once the card is wide enough, else two. */
const METRIC_GAP = 12;
const THREE_ACROSS_MIN = 560;

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

/** The Finance pages that use the wider content column on the web (see
 * WebSidebarShell's `wideRoutes`) - tables and ledgers that use the room. */
export const FINANCE_WIDE_ROUTES = [
  '/finance',
  '/daybook',
  '/transactions',
  '/customers',
  '/customer',
  '/quick-payment',
  '/received',
  '/paid',
  '/to-receive',
  '/to-give',
  '/bank-accounts',
  '/bank-balances',
  '/import-statement',
  '/inventory',
  '/report',
];

export function shortcuts(basePath: string): {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: string;
}[] {
  return [
    { key: 'daybook', label: 'Day Book', icon: 'book', href: `${basePath}/daybook` },
    { key: 'transactions', label: 'Statement', icon: 'document-text', href: `${basePath}/transactions` },
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
    // Quotation and Buy Stock only exist under (reseller) for now - a
    // wholesaler basePath has no matching routes, so these would be dead
    // links there.
    ...(basePath === '/(reseller)'
      ? [
          { key: 'quotation', label: 'Quotation', icon: 'document-text' as const, href: `${basePath}/quotation/new` },
          { key: 'buy-stock', label: 'Buy Stock', icon: 'storefront' as const, href: `${basePath}/wholesale` },
        ]
      : []),
  ];
}

// Purely a rendering hint (icon badge color per shortcut) - not part of the
// shortcuts() data/routing above, so restyling the grid can never touch the
// key/label/icon/href it returns.
const SHORTCUT_COLORS: Record<string, { bg: string; fg: string }> = {
  daybook: { bg: '#EFF6FF', fg: '#1D4ED8' },
  transactions: { bg: '#EFF6FF', fg: '#2563EB' },
  customers: { bg: '#EFF6FF', fg: '#2563EB' },
  'payment-in': { bg: '#ECFDF5', fg: '#059669' },
  'payment-out': { bg: '#FEF2F2', fg: '#DC2626' },
  sales: { bg: '#ECFDF5', fg: '#059669' },
  purchase: { bg: '#FEF2F2', fg: '#DC2626' },
  expenses: { bg: MONEY.out.bg, fg: MONEY.out.base },
  'bank-accounts': { bg: '#EEF2FF', fg: '#4F46E5' },
  'import-statement': { bg: '#F0FDFA', fg: '#0D9488' },
  inventory: { bg: '#F5F3FF', fg: '#7C3AED' },
  report: { bg: '#EFF6FF', fg: '#2563EB' },
  quotation: { bg: '#FDF4FF', fg: '#A21CAF' },
  'buy-stock': { bg: '#FFF7ED', fg: '#EA580C' },
};

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
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.3)" strokeWidth={strokeWidth} fill="none" />
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

/** The largest font size (down to `min`) at which `text` still fits `width`
 * px on one line. Bold digits run about 0.62em wide, so this is a safe
 * estimate - a long figure shrinks instead of being cut off. */
function fitFont(text: string, width: number, max: number, min = 11): number {
  let size = max;
  while (size > min && text.length * size * 0.62 > width) size -= 0.5;
  return size;
}

/** One headline figure. Every tile is the same size (the grid hands it an exact
 * width) and its value is fitted to that width, so none can overflow. */
function Metric({
  label,
  value,
  caption,
  icon,
  color,
  width,
  onPress,
}: {
  label: string;
  value: number;
  caption: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  width: number;
  onPress: () => void;
}) {
  const text = `${value < 0 ? '−' : ''}NPR ${Math.abs(value).toLocaleString()}`;
  const inner = width - 2 * 14 - 2; // padding and border
  return (
    <Pressable
      onPress={onPress}
      className="overflow-hidden rounded-2xl bg-white p-3.5"
      style={{ width, borderWidth: 1, borderColor: `${color}40` }}
    >
      <View className="mb-2.5 h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}1A` }}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text className="text-xs font-semibold text-gray-500" numberOfLines={1}>
        {label}
      </Text>
      <Text className="mt-0.5 font-extrabold" style={{ color, fontSize: fitFont(text, inner, 17), lineHeight: 22 }} numberOfLines={1}>
        {text}
      </Text>
      <Text className="mt-0.5 text-[11px] text-gray-400" numberOfLines={1}>
        {caption}
      </Text>
    </Pressable>
  );
}

export function FinanceDashboardScreen({ basePath }: { basePath: string }) {
  // Percentage widths (e.g. '31%') combined with a flex `gap` are computed
  // differently by React Native's native layout engine than by the browser,
  // so 3-across shortcut tiles that render correctly on web can wrap to 2 on
  // a real device. Computing an exact pixel width up front avoids that.
  const { width: screenWidth } = useWindowDimensions();
  const SCREEN_PADDING = 24; // px-6
  const GRID_GAP = 12; // gap-3
  const thirdTileWidth = (screenWidth - SCREEN_PADDING * 2 - GRID_GAP * 2) / 3;
  // With the sidebar showing, every shortcut is already a link on the left,
  // so the shortcut grid is only for phones (and phone-width browsers).
  const hasSidebar = Platform.OS === 'web' && screenWidth >= WEB_SIDEBAR_MIN_WIDTH;

  // The column split is worked out from the real width of the page body, not
  // the window: the sidebar and gutters have already taken their share. One
  // third / two thirds, shared by both rows so the card edges line up.
  const [bodyWidth, setBodyWidth] = useState(0);
  const twoColumn = bodyWidth >= TWO_COLUMN_MIN;
  const leftWidth = twoColumn ? Math.floor((bodyWidth - GAP) / 3) : bodyWidth;
  const rightWidth = twoColumn ? bodyWidth - GAP - leftWidth : bodyWidth;

  // The overview is one card: the balance on the left, the key figures beside
  // it (under it on a phone), split one third / two thirds like the row below.
  const CARD_PAD = 20; // the card's own padding
  const ZONE_GAP = 24; // either side of the divider
  const innerWidth = bodyWidth - 2 * CARD_PAD;
  const zoneLeft = twoColumn ? Math.floor((innerWidth - (2 * ZONE_GAP + 1)) / 3) : innerWidth;
  const zoneRight = twoColumn ? innerWidth - (2 * ZONE_GAP + 1) - zoneLeft : innerWidth;
  const metricCols = zoneRight >= THREE_ACROSS_MIN ? 3 : 2;
  const metricWidth = Math.floor((zoneRight - METRIC_GAP * (metricCols - 1)) / metricCols);

  const userId = useAuthStore((state) => state.session?.user.id);
  const profile = useAuthStore((state) => state.profile);
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

  // The combined cash-in-hand + bank balance across every account - shared
  // with the Bank Accounts screen's per-account breakdown so the two can
  // never drift apart (see useAccountBalances for the full formula).
  const accountBalances = useAccountBalances(userId);
  const availableBalance = accountBalances.total;

  // Matches TotalsReportScreen's definitions: "received" is a payment
  // actually collected from a customer (Payment In, or a synced job
  // payment) - NOT a Sale, which is its own separate figure (the Sales
  // tile) and, since 0061_sale_purchase_always_ledger.sql, books a debt
  // rather than cash received. "paid" is every expense, every manual
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

  const go = (path: string) => () => router.push(`${basePath}${path}` as never);
  const netProfit = totals.sale - totals.purchase - totals.expense;

  // Overview figures sit in half-width tiles; their text is fitted too.
  const halfTile = (zoneLeft - 12) / 2;
  const overviewTile = (label: string, caption: string, value: number, tone: MoneyTone, path: string) => {
    const text = `NPR ${value.toLocaleString()}`;
    return (
      <Pressable onPress={go(path)} className="flex-1 overflow-hidden rounded-xl p-3" style={{ backgroundColor: tone.bg }}>
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tone.base }} />
          <Text className="text-xs font-semibold text-gray-600">{label}</Text>
        </View>
        <Text className="mt-1 font-extrabold" style={{ color: tone.text, fontSize: fitFont(text, halfTile - 24, 15) }} numberOfLines={1}>
          {text}
        </Text>
        <Text className="mt-0.5 text-[11px] text-gray-400" numberOfLines={1}>
          {caption}
        </Text>
      </Pressable>
    );
  };

  const balanceText = `NPR ${availableBalance.toLocaleString()}`;
  const overview = (
    <Card title="Financial overview">
      <View style={{ flexDirection: twoColumn ? 'row' : 'column', gap: ZONE_GAP, alignItems: 'stretch' }}>
        <View style={{ width: zoneLeft }}>
          {/* Grows to take whatever height the row gives it, so it never ends in a blank strip. */}
          <Pressable onPress={go('/bank-balances')} style={{ flexGrow: 1 }}>
            <LinearGradient
              colors={['#2563EB', '#1D4ED8']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                flexGrow: 1,
                justifyContent: 'center',
                borderRadius: 16,
                padding: 18,
                shadowColor: '#2563EB',
                shadowOpacity: 0.3,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
                elevation: 4,
              }}
            >
              <Text className="text-xs font-semibold text-white/80">Available balance</Text>
              <Text
                className="mt-1 font-extrabold text-white"
                style={{ fontSize: fitFont(balanceText, zoneLeft - 2 * 18, 28, 18), lineHeight: 34 }}
                numberOfLines={1}
              >
                {balanceText}
              </Text>
              <Text className="mt-1 text-[11px] text-white/70">Cash in hand + all bank accounts</Text>
            </LinearGradient>
          </Pressable>

          <View className="mt-3 flex-row" style={{ gap: 12 }}>
            {overviewTile('Receivable', 'Customers owe you', toReceive, MONEY.in, '/to-receive')}
            {overviewTile('Payable', 'You owe vendors', toGive, MONEY.out, '/to-give')}
          </View>
        </View>

        {twoColumn && <View style={{ width: 1, backgroundColor: '#F1F2F4' }} />}

        <View style={{ width: zoneRight }}>
          <View className="flex-row flex-wrap" style={{ gap: METRIC_GAP }}>
            <Metric width={metricWidth} label="Sales" value={totals.sale} caption="All time" icon="trending-up" color={MONEY.in.base} onPress={go('/transactions?type=sale')} />
            <Metric width={metricWidth} label="Purchase" value={totals.purchase} caption="All time" icon="cart" color={MONEY.out.base} onPress={go('/transactions?type=purchase')} />
            <Metric width={metricWidth} label="Expense" value={totals.expense} caption="All time" icon="receipt" color={MONEY.out.base} onPress={go('/transactions?type=expense')} />
            <Metric width={metricWidth} label="Total received" value={yearReceived} caption="This year" icon="arrow-down-circle" color={MONEY.in.base} onPress={go('/received')} />
            <Metric width={metricWidth} label="Total paid" value={yearPaid} caption="This year" icon="arrow-up-circle" color={MONEY.out.base} onPress={go('/paid')} />
            <Metric
              width={metricWidth}
              label="Net profit"
              value={netProfit}
              caption="After all costs"
              icon="stats-chart"
              color={netProfit >= 0 ? MONEY.in.base : MONEY.out.base}
              onPress={go('/report')}
            />
          </View>
        </View>
      </View>
    </Card>
  );

  // Every shortcut is already a link in the sidebar, so this grid is for phones.
  const shortcutGrid = hasSidebar ? null : (
    <View>
      <Text className="mb-2 text-sm font-semibold text-gray-900">Shortcuts</Text>
      <View className="flex-row flex-wrap gap-3">
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
    </View>
  );

  const profileCompletionCard = profileCompletion < 100 && (
    <Pressable onPress={go('/profile')} className="overflow-hidden rounded-2xl">
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

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      contentContainerStyle={{ padding: GAP, paddingBottom: hasSidebar ? GAP : 40 }}
    >
      <View onLayout={(e) => setBodyWidth(e.nativeEvent.layout.width)} style={{ gap: GAP }}>
        {bodyWidth > 0 && (
          <>
            {overview}
            {shortcutGrid}
            {profileCompletionCard}

            {/* Stacked on a phone, the trend leads and the activity list follows. */}
            <View style={{ flexDirection: twoColumn ? 'row' : 'column-reverse', gap: GAP, alignItems: 'stretch' }}>
              <View style={{ width: leftWidth }}>
                <RecentActivityCard basePath={basePath} />
              </View>
              <View style={{ width: rightWidth }}>
                <SalesTrendCard />
              </View>
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}
