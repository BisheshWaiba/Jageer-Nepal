// lib/components/MyStorefront.tsx
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Image, TextInput, Switch, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../hooks/useAuth';
import { useSupabaseQuery, useSupabaseUpdate } from '../hooks/useSupabase';
import { SearchBar } from './SearchBar';
import { SearchFilterSheet } from './SearchFilterSheet';
import { WEB_SIDEBAR_MIN_WIDTH } from './web/WebSidebarShell';
import { ShopOverviewSection } from './ShopOverviewSection';
import { filterBySearch } from '../utils/search';
import { decimalInput } from '../utils/number';
import { showAlert, getErrorMessage } from '../utils/alert';
import { toSafeImageUri } from '../utils/image';
import { LOW_STOCK_THRESHOLD } from '../constants/stock';
import type { Product, UserRole } from '../../types/database.types';

function stockBadge(item: Product, effectiveAvailable: boolean) {
  if (!effectiveAvailable) return { label: 'Unavailable', bg: 'bg-gray-500' };
  if (item.stock_level <= 0) return { label: 'Out of stock', bg: 'bg-red-600' };
  if (item.stock_level < LOW_STOCK_THRESHOLD) return { label: 'Low stock', bg: 'bg-amber-500/90' };
  return { label: 'In stock', bg: 'bg-emerald-600/90' };
}

function EditablePrice({ item }: { item: Product }) {
  const updateProduct = useSupabaseUpdate('products');
  const [editing, setEditing] = useState(Number(item.price) <= 0);
  const [price, setPrice] = useState(Number(item.price) > 0 ? String(item.price) : '');
  const [saving, setSaving] = useState(false);

  // Re-sync once the save round-trips and the fresh row comes back through
  // the query - otherwise a second edit would start from the stale value.
  useEffect(() => {
    if (!editing) setPrice(Number(item.price) > 0 ? String(item.price) : '');
  }, [item.price, editing]);

  async function handleSave() {
    const priceNum = parseFloat(price);
    if (Number.isNaN(priceNum) || priceNum <= 0) {
      showAlert('Set a price', 'Enter a valid selling price.');
      return;
    }
    setSaving(true);
    try {
      // Pricing an item for the first time is what makes it sellable at all
      // (see the disabled Available switch below), so treat it as the
      // seller's intent to go live rather than leaving them to flip a
      // second switch right after.
      const wasUnpriced = Number(item.price) <= 0;
      await updateProduct.mutateAsync({
        id: item.id,
        values: wasUnpriced ? { price: priceNum, is_listed: true } : { price: priceNum },
      });
      setEditing(false);
    } catch (err) {
      showAlert('Could not update price', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <View className="flex-row items-center gap-1.5">
        <TextInput
          value={price}
          onChangeText={(v) => setPrice(decimalInput(v))}
          placeholder="Set price"
          keyboardType="decimal-pad"
          autoFocus={Number(item.price) > 0}
          className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-900"
        />
        <Pressable
          onPress={handleSave}
          disabled={saving}
          className="rounded-lg bg-orange-500 px-2.5 py-1.5 disabled:opacity-50"
        >
          <Text className="text-xs font-semibold text-white">{saving ? '…' : 'Save'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable onPress={() => setEditing(true)} className="flex-row items-center gap-1.5">
      <Text className="text-base font-bold text-gray-900">NPR {Number(item.price).toLocaleString()}</Text>
      <Ionicons name="create-outline" size={15} color="#6B7280" />
    </Pressable>
  );
}

function ProductThumbnail({ item }: { item: Product }) {
  const [failed, setFailed] = useState(false);
  const uri = toSafeImageUri(item.image_url);

  if (!uri || failed) {
    return <Text className="text-3xl">🖥️</Text>;
  }
  return (
    <Image
      source={{ uri }}
      className="h-full w-full"
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

// A wide web grid wants cards about this wide, so a bigger screen shows more
// of them per row instead of a few huge ones.
const WIDE_CARD_WIDTH = 220;
const WIDE_GRID_GAP = 16;

/** `fill` makes the card take its whole cell instead of the phone layout's
 * fixed 48% (two to a row) - used by the wide web grid below. */
function StorefrontCard({ item, basePath, fill }: { item: Product; basePath: string; fill?: boolean }) {
  const updateProduct = useSupabaseUpdate('products');
  const isAvailable = item.is_listed ?? true;
  const hasPrice = Number(item.price) > 0;
  // Can't actually be available to buy without a selling price, no matter
  // what the switch is set to underneath (e.g. a fresh wholesale purchase
  // defaults to listed but starts unpriced) - so the switch reflects and
  // only accepts changes to this effective state, not the raw column.
  const effectiveAvailable = isAvailable && hasPrice;
  const outOfStock = item.stock_level <= 0;
  const badge = stockBadge(item, effectiveAvailable);
  const detailHref = item.catalog_id ? `${basePath}/catalog/${item.catalog_id}` : null;
  const purchasePrice = item.purchase_price ?? null;

  async function handleToggleAvailable(next: boolean) {
    try {
      await updateProduct.mutateAsync({ id: item.id, values: { is_listed: next } });
    } catch (err) {
      showAlert('Could not update availability', getErrorMessage(err));
    }
  }

  // Unavailable (paused, or simply unpriced) takes priority over the
  // out-of-stock look - either way the card stays visible and editable to
  // the seller, only real customers ever have it filtered out (see
  // (client)/market.tsx and (reseller)/wholesale.tsx).
  const faded = !effectiveAvailable || outOfStock;
  const cardTone = !effectiveAvailable
    ? 'border-gray-300 bg-gray-50'
    : outOfStock
      ? 'border-red-200 bg-red-50'
      : 'border-gray-200 bg-white';

  return (
    <View className={`mb-4 ${fill ? 'w-full' : 'w-[48%]'} rounded-xl border p-3 ${cardTone} ${faded ? 'opacity-60' : ''}`}>
      <Pressable
        onPress={() => detailHref && router.push(detailHref)}
        className="mb-2 aspect-square items-center justify-center overflow-hidden rounded-lg bg-gray-100"
      >
        <ProductThumbnail item={item} />
        <View className={`absolute left-1 top-1 rounded-full px-2 py-0.5 ${badge.bg}`}>
          <Text className="text-[9px] font-bold uppercase tracking-wide text-white">{badge.label}</Text>
        </View>
      </Pressable>

      <Pressable onPress={() => detailHref && router.push(detailHref)}>
        {item.category && (
          <Text className="text-[10px] uppercase tracking-wide text-orange-600" numberOfLines={1}>
            {item.category}
          </Text>
        )}
        <Text className="mb-1 text-sm font-semibold text-gray-900" numberOfLines={2}>
          {item.name}
        </Text>
      </Pressable>

      <EditablePrice item={item} />

      {purchasePrice != null && (
        <Text className="mt-1 text-[10px] text-gray-500" numberOfLines={1}>
          Bought at NPR {Number(purchasePrice).toLocaleString()}
        </Text>
      )}

      <Text className={`mt-0.5 text-[10px] ${outOfStock ? 'text-red-500' : 'text-gray-400'}`}>
        {outOfStock ? 'Restock to sell' : `${item.stock_level} in stock`}
      </Text>

      <View className="mt-1.5 flex-row items-center justify-between">
        <Text className="text-[10px] font-medium text-gray-500">Available</Text>
        <Switch
          value={effectiveAvailable}
          onValueChange={handleToggleAvailable}
          disabled={!hasPrice}
          style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
          trackColor={{ false: '#D1D5DB', true: '#93c5fd' }}
          thumbColor={effectiveAvailable ? '#3b82f6' : '#F3F4F6'}
        />
      </View>
    </View>
  );
}

export function MyStorefront({
  sellerRole,
  emptyText,
  basePath,
}: {
  sellerRole: UserRole;
  emptyText: string;
  basePath: string;
}) {
  const userId = useAuthStore((state) => state.session?.user.id);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Wide web: as many cards per row as fit at WIDE_CARD_WIDTH, measured from
  // the grid itself so it follows whatever width the page column ends up
  // with. A phone (or a phone browser) keeps the plain two-per-row grid.
  const { width: windowWidth } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(0);
  const wideGrid = Platform.OS === 'web' && windowWidth >= WEB_SIDEBAR_MIN_WIDTH;
  const columns = Math.min(8, Math.max(2, Math.floor(gridWidth / (WIDE_CARD_WIDTH + WIDE_GRID_GAP))));

  const { data: products, isLoading } = useSupabaseQuery('products', {
    filters: { seller_id: userId ?? '', seller_role: sellerRole },
    enabled: !!userId,
  });

  // This screen is the seller's own view of everything they've stocked, so
  // it always shows every product regardless of is_listed or stock level -
  // turning Available off never removes anything here, only from the real
  // customer-facing marketplace query in (client)/market.tsx, which already
  // filters on is_listed and stock_level independently of this component.
  const visible = useMemo(() => products ?? [], [products]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    visible.forEach((p) => p.category && set.add(p.category));
    return Array.from(set);
  }, [visible]);

  const filtered = useMemo(() => {
    let list = filterBySearch(visible, search);
    if (category) {
      list = list.filter((p) => p.category === category);
    }
    return [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [visible, search, category]);

  // Matching item names as you type, so you can jump straight to one instead
  // of scanning the whole (already-filtered) grid below.
  const nameSuggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return visible.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [visible, search]);

  if (!isLoading && visible.length === 0) {
    return (
      <View className="items-center rounded-2xl border border-dashed border-gray-200 bg-white py-12">
        <Ionicons name="storefront-outline" size={36} color="#D1D5DB" />
        <Text className="mt-3 text-sm font-semibold text-gray-700">Nothing live yet</Text>
        <Text className="mt-1 px-8 text-center text-xs text-gray-400">{emptyText}</Text>
      </View>
    );
  }

  function handleSearchChange(text: string) {
    setSearch(text);
    setShowSuggestions(true);
    if (sheetOpen) setSheetOpen(false);
  }

  function selectSuggestion(name: string) {
    setSearch(name);
    setShowSuggestions(false);
  }

  return (
    <>
      {sellerRole === 'reseller' && <ShopOverviewSection />}

      <View className="mb-4">
        <SearchBar
          value={search}
          onChangeText={handleSearchChange}
          onFocus={() => setShowSuggestions(true)}
          onOpenFilters={() => setSheetOpen(true)}
          filterActive={!!category}
          placeholder="Search by name or model…"
        />
        {showSuggestions && nameSuggestions.length > 0 && (
          <View className="mt-1.5 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {nameSuggestions.map((p, idx) => (
              <Pressable
                key={p.id}
                onPress={() => selectSuggestion(p.name)}
                className={`flex-row items-center gap-2 px-3 py-2.5 ${idx !== nameSuggestions.length - 1 ? 'border-b border-gray-100' : ''}`}
              >
                <Ionicons name="search" size={14} color="#9CA3AF" />
                <Text className="flex-1 text-sm text-gray-900" numberOfLines={1}>
                  {p.name}
                </Text>
                {!!p.category && <Text className="text-xs text-gray-400">{p.category}</Text>}
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <SearchFilterSheet
        visible={sheetOpen}
        category={category}
        categories={categories}
        onSelect={setCategory}
        onClose={() => setSheetOpen(false)}
      />

      {isLoading && <Text className="text-gray-500">Loading…</Text>}
      {!isLoading && filtered.length === 0 && <Text className="text-gray-500">No products match your search.</Text>}

      <View
        className={wideGrid ? 'flex-row flex-wrap' : 'flex-row flex-wrap justify-between'}
        // Each wide cell pads half the gap on both sides; this pulls the
        // outer edges back out so the grid still lines up with the page.
        style={wideGrid ? { marginHorizontal: -WIDE_GRID_GAP / 2 } : undefined}
        onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
      >
        {filtered.map((item) =>
          wideGrid ? (
            <View key={item.id} style={{ width: `${100 / columns}%`, paddingHorizontal: WIDE_GRID_GAP / 2 }}>
              <StorefrontCard item={item} basePath={basePath} fill />
            </View>
          ) : (
            <StorefrontCard key={item.id} item={item} basePath={basePath} />
          )
        )}
      </View>
    </>
  );
}
