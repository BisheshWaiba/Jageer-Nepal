// lib/components/finance/PartyBalancesScreen.tsx
import { useMemo } from 'react';
import { View, Text, Pressable, FlatList } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useBarActions, useBookLayout } from './BookKit';
import { useSupabaseQuery } from '../../hooks/useSupabase';

type Direction = 'receive' | 'give';

interface Row {
  partyId: string;
  name: string;
  balance: number;
}

// Matches the dashboard's To Receive/To Give tiles exactly (emerald-700 /
// red-600 text on emerald-50 / red-50, emerald-200 / red-200 borders) so
// opening either one feels like the same card, just expanded.
const META: Record<
  Direction,
  { title: string; subtitle?: string; color: string; bg: string; border: string; icon: keyof typeof Ionicons.glyphMap; empty: string }
> = {
  receive: {
    title: 'To Receive',
    subtitle: 'Customers who owe you money',
    color: '#047857',
    bg: '#ECFDF5',
    border: '#A7F3D0',
    icon: 'people-outline',
    empty: 'No customer owes you anything right now.',
  },
  give: {
    title: 'To Give',
    color: '#DC2626',
    bg: '#FEF2F2',
    border: '#FECACA',
    icon: 'cart-outline',
    empty: "You don't owe any vendor right now.",
  },
};

/** Detail view behind the dashboard's To Receive / To Give tiles - who
 * specifically makes up that total, so it isn't just one opaque number.
 * Reads customer_ledger_entries for "receive" (customers who owe the
 * business) or vendor_ledger_entries for "give" (vendors the business
 * owes) - opposite tables with opposite polarity, see 0059_vendor_ledger.sql. */
export function PartyBalancesScreen({ basePath, direction }: { basePath: string; direction: Direction }) {
  const meta = META[direction];
  const userId = useAuthStore((state) => state.session?.user.id);
  const { data: customers } = useSupabaseQuery('customers', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { data: customerEntries } = useSupabaseQuery('customer_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId && direction === 'receive',
  });
  const { data: vendorEntries } = useSupabaseQuery('vendor_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId && direction === 'give',
  });

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    (customers ?? []).forEach((c) => map.set(c.id, c.name));
    return map;
  }, [customers]);

  const rows = useMemo((): Row[] => {
    const perParty: Record<string, number> = {};
    if (direction === 'receive') {
      for (const e of customerEntries ?? []) {
        perParty[e.customer_id] = (perParty[e.customer_id] ?? 0) + (e.entry_type === 'debit' ? e.amount : -e.amount);
      }
    } else {
      for (const e of vendorEntries ?? []) {
        perParty[e.vendor_id] = (perParty[e.vendor_id] ?? 0) + (e.entry_type === 'debit' ? e.amount : -e.amount);
      }
    }
    return Object.entries(perParty)
      .filter(([, balance]) => balance > 0)
      .map(([partyId, balance]) => ({ partyId, name: nameById.get(partyId) ?? 'Unknown', balance }))
      .sort((a, b) => b.balance - a.balance);
  }, [direction, customerEntries, vendorEntries, nameById]);

  const total = rows.reduce((sum, r) => sum + r.balance, 0);

  // The name (and the back button on a phone) are in the top bar.
  const layout = useBookLayout();
  useBarActions({ wide: layout.wide }, []);

  return (
    <View className="flex-1 bg-gray-50 px-6 pt-4">
      <View className="mb-4 rounded-2xl border p-4" style={{ backgroundColor: meta.bg, borderColor: meta.border }}>
        {!!meta.subtitle && (
          <View className="mb-1 flex-row items-center gap-2">
            <Ionicons name={meta.icon} size={16} color={meta.color} />
            <Text className="text-xs font-semibold" style={{ color: meta.color }}>
              {meta.subtitle}
            </Text>
          </View>
        )}
        <Text className="text-2xl font-extrabold" style={{ color: meta.color }}>
          NPR {total.toLocaleString()}
        </Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.partyId}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`${basePath}/customer/${item.partyId}` as any)}
            className="mb-2.5 flex-row items-center justify-between rounded-2xl border border-gray-200 bg-white p-4"
          >
            <Text className="flex-1 pr-2 text-sm font-semibold text-gray-900" numberOfLines={1}>
              {item.name}
            </Text>
            <Text className="text-sm font-extrabold" style={{ color: meta.color }}>
              NPR {item.balance.toLocaleString()}
            </Text>
            <Ionicons name="chevron-forward" size={14} color="#D1D5DB" style={{ marginLeft: 6 }} />
          </Pressable>
        )}
        ListEmptyComponent={
          <View className="items-center rounded-2xl border border-dashed border-gray-200 bg-white py-10">
            <Ionicons name={meta.icon} size={28} color="#D1D5DB" />
            <Text className="mt-2 text-gray-500">{meta.empty}</Text>
          </View>
        }
      />
    </View>
  );
}
