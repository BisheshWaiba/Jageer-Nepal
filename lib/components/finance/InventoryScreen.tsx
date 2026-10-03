// lib/components/finance/InventoryScreen.tsx
import { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useRole } from '../../hooks/useAuth';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { BackButton, BookPage, BookStat, BookStats, BookTable, FilterTabs, Pill, ToolbarSearch, money, useBookLayout, useBookToolbar, type BookColumn } from './BookKit';

type StockStatus = 'ok' | 'out' | 'untracked';
type StatusFilter = 'all' | 'out';

const STATUS = {
  ok: { label: 'In stock', color: '#047857', bg: '#ECFDF5' },
  out: { label: 'Out', color: '#B91C1C', bg: '#FEF2F2' },
  untracked: { label: 'Bills only', color: '#4B5563', bg: '#F3F4F6' },
} satisfies Record<StockStatus, { label: string; color: string; bg: string }>;

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'out', label: 'Out' },
];

interface InventoryRow {
  key: string;
  name: string;
  category: string | null;
  price: number | null;
  cost: number | null;
  stockLevel: number | null; // null = not a real catalog product, so no tracked stock level
  sold: number;
  purchased: number;
  status: StockStatus;
  /** Stock on hand at cost price; null when there's no stock level or no cost. */
  value: number | null;
}

/** Quantities and prices keep their decimals (2.5 kg, Rs 12.50); `money` would round. */
const qty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });
const rs = (n: number | null) => (n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));

/** Stock list cross-referenced with Finance - each product's current stock
 * level next to how many units of it have actually moved through Sale and
 * Purchase bills (matched by item name, since a bill's line items are typed
 * or picked names, not a foreign key back to `products`). Also includes
 * items that only ever exist as a typed name in a bill (finance_items,
 * 0063_finance_items.sql) - a reseller can't add just any name to the real
 * product catalog (it's admin-curated), so plenty of what's actually bought
 * and sold only lives there, not in `products`. Read-only: products are
 * managed by admins, not from here. */
export function InventoryScreen() {
  const layout = useBookLayout();
  const userId = useAuthStore((state) => state.session?.user.id);
  const role = useRole();
  const { data: products } = useSupabaseQuery('products', {
    filters: userId && role ? { seller_id: userId, seller_role: role } : {},
    orderBy: { column: 'name' },
    enabled: !!userId && !!role,
  });
  const { data: financeItems } = useSupabaseQuery('finance_items', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { data: transactions } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  // Search and the All / Out filter live in the top bar on a wide screen (a
  // plain row above the tiles on a phone).
  const toolbar = useBookToolbar(
    {
      wide: layout.wide,
      left: layout.wide ? undefined : () => <BackButton onPress={() => router.back()} />,
      right: (inBar) => (
        <>
          <ToolbarSearch value={search} onChange={setSearch} placeholder="Search your products" wide={inBar} />
          <FilterTabs options={FILTERS} value={filter} onChange={setFilter} />
        </>
      ),
    },
    [search, filter]
  );

  const rows = useMemo((): InventoryRow[] => {
    const soldByName = new Map<string, number>();
    const purchasedByName = new Map<string, number>();
    for (const t of transactions ?? []) {
      if (t.type !== 'sale' && t.type !== 'purchase') continue;
      const target = t.type === 'sale' ? soldByName : purchasedByName;
      for (const item of t.items) {
        const key = item.description.trim().toLowerCase();
        target.set(key, (target.get(key) ?? 0) + item.qty);
      }
    }

    const seenNames = new Set<string>();
    const productRows: InventoryRow[] = (products ?? []).map((product) => {
      const key = product.name.trim().toLowerCase();
      seenNames.add(key);
      const stock = Number(product.stock_level);
      const cost = product.purchase_price != null ? Number(product.purchase_price) : null;
      return {
        key: `p-${product.id}`,
        name: product.name,
        category: product.category,
        price: Number(product.price),
        cost,
        stockLevel: stock,
        sold: soldByName.get(key) ?? 0,
        purchased: purchasedByName.get(key) ?? 0,
        status: stock <= 0 ? 'out' : 'ok',
        value: cost != null && stock > 0 ? stock * cost : null,
      };
    });

    // A typed item that's never actually shown up in a bill (rate saved but
    // never used) isn't real inventory yet - only list ones with activity.
    const financeItemRows: InventoryRow[] = (financeItems ?? [])
      .filter((item) => !seenNames.has(item.name.trim().toLowerCase()))
      .map((item): InventoryRow | null => {
        const key = item.name.trim().toLowerCase();
        const sold = soldByName.get(key) ?? 0;
        const purchased = purchasedByName.get(key) ?? 0;
        if (sold === 0 && purchased === 0) return null;
        return {
          key: `f-${item.id}`,
          name: item.name,
          category: null,
          price: item.rate,
          cost: null,
          stockLevel: null,
          sold,
          purchased,
          status: 'untracked',
          value: null,
        };
      })
      .filter((r): r is InventoryRow => r !== null);

    return [...productRows, ...financeItemRows].sort((a, b) => a.name.localeCompare(b.name));
  }, [products, financeItems, transactions]);

  const stats = useMemo(
    () => ({
      items: rows.length,
      value: rows.reduce((sum, r) => sum + (r.value ?? 0), 0),
      out: rows.filter((r) => r.status === 'out').length,
    }),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'out' && r.status !== 'out') return false;
      return !q || r.name.toLowerCase().includes(q) || (r.category ?? '').toLowerCase().includes(q);
    });
  }, [rows, search, filter]);

  const totals = useMemo(
    () => ({
      sold: filteredRows.reduce((sum, r) => sum + r.sold, 0),
      purchased: filteredRows.reduce((sum, r) => sum + r.purchased, 0),
      value: filteredRows.reduce((sum, r) => sum + (r.value ?? 0), 0),
    }),
    [filteredRows]
  );

  const num = (text: string, color = '#374151', bold = false) => (
    <Text className={`text-[12.5px] ${bold ? 'font-bold' : 'font-medium'}`} style={{ color }} numberOfLines={1}>
      {text}
    </Text>
  );
  const dash = <Text className="text-[12.5px] text-gray-400">—</Text>;

  const stockColor = (r: InventoryRow) => (r.status === 'out' ? '#B91C1C' : '#111827');

  const itemCell = (r: InventoryRow, compact: boolean) => (
    <View style={{ minWidth: 0, gap: 2 }}>
      <Text className="text-[13px] font-medium text-gray-900" numberOfLines={1}>
        {r.name}
      </Text>
      {compact && <Pill text={STATUS[r.status].label} color={STATUS[r.status].color} bg={STATUS[r.status].bg} />}
      {!!r.category && (
        <Text className="text-[11px] text-gray-400" numberOfLines={1}>
          {r.category}
        </Text>
      )}
      {compact && (
        <Text className="text-[11px] text-gray-400" numberOfLines={1}>
          Sold {qty(r.sold)} · Bought {qty(r.purchased)}
        </Text>
      )}
    </View>
  );

  const columns: BookColumn<InventoryRow>[] = layout.full
    ? [
        { key: 'item', label: 'Item', render: (r) => itemCell(r, false) },
        { key: 'stock', label: 'In stock', width: 96, align: 'right', render: (r) => (r.stockLevel != null ? num(qty(r.stockLevel), stockColor(r), true) : dash) },
        { key: 'status', label: 'Status', width: 90, render: (r) => <Pill text={STATUS[r.status].label} color={STATUS[r.status].color} bg={STATUS[r.status].bg} /> },
        { key: 'cost', label: 'Cost price', width: 90, align: 'right', render: (r) => (r.cost != null ? num(rs(r.cost), '#4B5563') : dash) },
        { key: 'price', label: 'Selling price', width: 100, align: 'right', render: (r) => (r.price != null ? num(rs(r.price)) : dash) },
        { key: 'sold', label: 'Sold', width: 72, align: 'right', render: (r) => num(qty(r.sold), '#047857', true) },
        { key: 'purchased', label: 'Purchased', width: 92, align: 'right', render: (r) => num(qty(r.purchased), '#B91C1C', true) },
        { key: 'value', label: 'Stock value', width: 108, align: 'right', render: (r) => (r.value != null ? num(money(r.value)) : dash) },
      ]
    : [
        { key: 'item', label: 'Item', render: (r) => itemCell(r, true) },
        { key: 'stock', label: 'In stock', width: 84, align: 'right', render: (r) => (r.stockLevel != null ? num(qty(r.stockLevel), stockColor(r), true) : dash) },
        { key: 'price', label: 'Price', width: 80, align: 'right', render: (r) => (r.price != null ? num(rs(r.price)) : dash) },
      ];

  const footer = layout.full
    ? {
        label: `${filteredRows.length} ${filteredRows.length === 1 ? 'item' : 'items'} · Totals`,
        cells: {
          sold: <Text className="text-[13px] font-extrabold" style={{ color: '#047857' }}>{qty(totals.sold)}</Text>,
          purchased: <Text className="text-[13px] font-extrabold" style={{ color: '#B91C1C' }}>{qty(totals.purchased)}</Text>,
          value: <Text className="text-[13px] font-extrabold text-gray-900">{money(totals.value)}</Text>,
        },
      }
    : undefined;

  const toggleOut = () => setFilter((f) => (f === 'out' ? 'all' : 'out'));

  return (
    <BookPage wide={layout.wide}>
      {toolbar}

      <BookStats>
        <BookStat label="Items" value={String(stats.items)} color="#374151" />
        <BookStat label="Stock value (cost)" value={`NPR ${money(stats.value)}`} color="#1D4ED8" />
        <BookStat label="Out of stock" value={String(stats.out)} color="#B91C1C" onPress={toggleOut} />
      </BookStats>

      {filteredRows.length === 0 ? (
        <View className="items-center rounded-xl border border-gray-300 bg-white py-10">
          <Ionicons name="cube-outline" size={28} color="#D1D5DB" />
          <Text className="mt-2 text-gray-500">{rows.length > 0 ? 'No matches.' : 'Nothing bought or sold yet.'}</Text>
        </View>
      ) : (
        <BookTable columns={columns} rows={filteredRows} rowKey={(r) => r.key} footer={footer} />
      )}

      <Text className="px-1 text-[11.5px] leading-[17px] text-gray-400">
        Sold and Purchased count the units on your Sale and Purchase bills, matched to products by item name. Items marked "Bills only" were typed into a
        bill and are not catalog products, so they have no tracked stock.
      </Text>
    </BookPage>
  );
}
