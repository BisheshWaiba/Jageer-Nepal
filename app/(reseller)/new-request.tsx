// app/(reseller)/new-request.tsx
import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Platform, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSupabaseQuery } from '../../lib/hooks/useSupabase';
import { CategoryBadge } from '../../lib/components/CategoryBadge';
import { WEB_SIDEBAR_MIN_WIDTH } from '../../lib/components/web/WebSidebarShell';

const SERVICE_ACTIONS = [
  { key: 'Repair', icon: 'construct-outline' },
  { key: 'Installation', icon: 'add-circle-outline' },
] as const;
type ServiceAction = (typeof SERVICE_ACTIONS)[number]['key'];

// Mirrors WebSidebarShell's layout (240px sidebar, 1120px content cap, 32px
// side padding) so the tile count follows the real width of the grid.
function gridColumns(width: number, isWideWeb: boolean): number {
  const gridWidth = isWideWeb ? Math.min(width - 240, 1120) - 64 - 40 : width - 32;
  return Math.max(4, Math.min(8, Math.floor(gridWidth / 120)));
}

export default function ResellerNewRequest() {
  // `from` is the tab this form was opened from, carried through to the
  // details step so finishing (or cancelling) lands back there - see
  // returnPathOr in lib/utils/returnPath.ts.
  // `keep` is set when the details form sent us here via "Change" - handing
  // its form key back means only the service changes and everything already
  // filled in stays; otherwise a fresh key starts a clean form.
  const { category: presetCategory, from, keep } = useLocalSearchParams<{ category?: string; from?: string; keep?: string }>();
  const { width } = useWindowDimensions();
  const isWideWeb = Platform.OS === 'web' && width >= WEB_SIDEBAR_MIN_WIDTH;
  const columns = gridColumns(width, isWideWeb);

  const [action, setAction] = useState<ServiceAction>('Repair');
  const [query, setQuery] = useState('');

  const { data: categories, isLoading: loadingCategories } = useSupabaseQuery('service_categories', {
    filters: { is_active: true },
    orderBy: { column: 'sort_order' },
  });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories ?? [];
    return (categories ?? []).filter(
      (c) => c.label.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q)
    );
  }, [categories, query]);

  function goToDetails(category: string) {
    router.push(
      `/(reseller)/request-details?category=${encodeURIComponent(category)}&action=${encodeURIComponent(action)}` +
        `&n=${encodeURIComponent(keep || String(Date.now()))}` +
        (from ? `&from=${encodeURIComponent(from)}` : '')
    );
  }

  const actionToggle = (
    <View className="flex-row rounded-xl bg-gray-200 p-1" style={isWideWeb ? { width: 300 } : undefined}>
      {SERVICE_ACTIONS.map((a) => {
        const active = action === a.key;
        return (
          <Pressable
            key={a.key}
            onPress={() => setAction(a.key)}
            className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-lg ${active ? 'bg-white' : ''}`}
            style={[{ height: 40 }, active ? { shadowColor: '#111827', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : null]}
          >
            <Ionicons name={a.icon} size={16} color={active ? '#1D4ED8' : '#6B7280'} />
            <Text className={`text-sm ${active ? 'font-bold text-orange-700' : 'font-semibold text-gray-500'}`}>{a.key}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const searchBox = (
    <View className="flex-row items-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5" style={{ minHeight: 48, flex: isWideWeb ? 1 : undefined }}>
      <Ionicons name="search" size={18} color="#9CA3AF" />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search — CCTV, AC, printer, WiFi…"
        placeholderTextColor="#9CA3AF"
        className="flex-1 py-3 text-base text-gray-900"
      />
      {!!query && (
        <Pressable onPress={() => setQuery('')} hitSlop={8}>
          <Ionicons name="close-circle" size={18} color="#9CA3AF" />
        </Pressable>
      )}
    </View>
  );

  const grid = (
    <View className="flex-row flex-wrap" style={{ marginHorizontal: -4 }}>
      {visible.map((c) => {
        const isPreset = presetCategory === c.label;
        return (
          <View key={c.id} style={{ width: `${100 / columns}%`, padding: 4 }}>
            <Pressable
              onPress={() => goToDetails(c.label)}
              className={`items-center rounded-2xl px-1 pb-2 pt-2.5 ${isPreset ? 'bg-orange-50' : 'bg-white'}`}
              style={{
                minHeight: isWideWeb ? 112 : 96,
                gap: 6,
                borderWidth: isPreset ? 2 : 1,
                borderColor: isPreset ? '#2563EB' : '#E5E7EB',
              }}
            >
              <CategoryBadge
                category={c.label}
                emoji={c.icon}
                categoryId={c.id}
                visualKey={c.visual_key}
                size={isWideWeb ? 44 : 40}
              />
              <Text
                numberOfLines={3}
                className={`text-center font-semibold ${isPreset ? 'text-orange-700' : 'text-gray-900'}`}
                style={{ fontSize: isWideWeb ? 12.5 : 11, lineHeight: isWideWeb ? 16 : 13 }}
              >
                {c.label}
              </Text>
              {isPreset && (
                <View className="absolute right-1.5 top-1.5 h-4 w-4 items-center justify-center rounded-full bg-orange-600">
                  <Ionicons name="checkmark" size={11} color="#fff" />
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      contentContainerStyle={{ padding: isWideWeb ? 32 : 16, paddingTop: isWideWeb ? 24 : 16, paddingBottom: 100 }}
    >
      <View className={isWideWeb ? 'rounded-2xl border border-gray-200 bg-white p-5' : ''} style={{ gap: 12 }}>
        {isWideWeb ? (
          <View className="flex-row items-center gap-3">
            {searchBox}
            {actionToggle}
          </View>
        ) : (
          <>
            {actionToggle}
            {searchBox}
          </>
        )}

        {loadingCategories && <Text className="text-gray-500">Loading services…</Text>}
        {grid}
        {!loadingCategories && visible.length === 0 && (
          <Text className="py-6 text-center text-sm text-gray-500">No service matches that search.</Text>
        )}
      </View>
    </ScrollView>
  );
}
