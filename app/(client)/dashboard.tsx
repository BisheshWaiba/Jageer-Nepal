// app/(client)/dashboard.tsx
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { useSupabaseQuery } from '../../lib/hooks/useSupabase';
import { CategoryGrid } from '../../lib/components/CategoryGrid';
import { ServiceActionSheet } from '../../lib/components/ServiceActionSheet';
import { PersonAvatar } from '../../lib/components/PersonAvatar';
import { SaveContactButton } from '../../lib/components/SaveContactButton';
import { STATUS_STYLES } from '../../lib/constants/requestStatus';
import type { Profile, ServiceCategory, ServiceRequest, RequestStatus } from '../../types/database.types';

function StatusPill({ status }: { status: RequestStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <View className={`rounded-full px-2 py-0.5 ${style.bg}`}>
      <Text className={`text-[10px] font-semibold uppercase ${style.text}`}>{style.label}</Text>
    </View>
  );
}

export default function ClientDashboard() {
  const profile = useAuthStore((state) => state.profile);
  const userId = useAuthStore((state) => state.session?.user.id);
  const [search, setSearch] = useState('');
  const [pickerCategory, setPickerCategory] = useState<ServiceCategory | null>(null);

  const { data: resellers } = useSupabaseQuery('profiles', { filters: { role: 'reseller' } });
  const { data: myRequests } = useSupabaseQuery('service_requests', {
    filters: userId ? { client_id: userId } : {},
    enabled: !!userId,
  });

  const { data: categories } = useSupabaseQuery('service_categories', {
    filters: { is_active: true },
    orderBy: { column: 'sort_order' },
  });

  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories ?? [];
    return (categories ?? []).filter((c) => c.label.toLowerCase().includes(q));
  }, [categories, search]);

  const recentlyHiredResellers = useMemo(() => {
    const statsByReseller = new Map<string, { lastRequest: ServiceRequest; count: number }>();
    (myRequests ?? []).forEach((r) => {
      if (!r.reseller_id) return;
      const existing = statsByReseller.get(r.reseller_id);
      const isNewer = !existing || r.created_at > existing.lastRequest.created_at;
      statsByReseller.set(r.reseller_id, {
        lastRequest: isNewer ? r : existing!.lastRequest,
        count: (existing?.count ?? 0) + 1,
      });
    });
    const resellerMap = new Map((resellers ?? []).map((p) => [p.id, p]));
    return Array.from(statsByReseller.entries())
      .map(([resellerId, stats]) => ({ reseller: resellerMap.get(resellerId), ...stats }))
      .filter((entry): entry is { reseller: Profile; lastRequest: ServiceRequest; count: number } => !!entry.reseller)
      .sort((a, b) => new Date(b.lastRequest.created_at).getTime() - new Date(a.lastRequest.created_at).getTime())
      .slice(0, 3);
  }, [myRequests, resellers]);

  return (
    <>
      <ScrollView className="flex-1 bg-gray-50" contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-6 pb-2 pt-4">
          <Text className="text-2xl font-extrabold text-gray-900">
            Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}
          </Text>
        </View>

        <View className="px-6 pt-3">
          <View className="mb-4 flex-row items-center rounded-2xl border border-gray-200 bg-white px-4 py-3">
            <Ionicons name="search" size={18} color="#9CA3AF" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search for services..."
              placeholderTextColor="#9CA3AF"
              className="ml-2 flex-1 text-sm text-gray-900"
            />
          </View>

          <Pressable
            onPress={() => router.push('/(client)/new-request?from=dashboard')}
            className="mb-5 flex-row items-center justify-between rounded-2xl bg-orange-500 px-4 py-3.5"
          >
            <View>
              <Text className="text-[14.5px] font-bold text-white">Need IT help?</Text>
              <Text className="mt-0.5 text-xs text-orange-100">Report an issue in seconds</Text>
            </View>
            <View className="rounded-full bg-white px-4 py-2">
              <Text className="text-xs font-bold text-orange-600">Request</Text>
            </View>
          </Pressable>

          <Text className="mb-3 text-[15px] font-bold text-gray-900">Browse by category</Text>
          <CategoryGrid categories={filteredCategories} onSelect={setPickerCategory} />

          {recentlyHiredResellers.length > 0 && (
            <>
              <Text className="mb-3 mt-3 text-[15px] font-bold text-gray-900">Recently Hired Reseller</Text>
              {recentlyHiredResellers.map(({ reseller, lastRequest }) => (
                <Pressable
                  key={reseller.id}
                  onPress={() => router.push(`/(client)/reseller/${reseller.id}`)}
                  className="mb-2.5 flex-row items-center gap-2.5 rounded-2xl border border-gray-200 bg-white p-3"
                >
                  <PersonAvatar name={reseller.full_name} photoUrl={reseller.avatar_url} size={36} />
                  <Text className="flex-1 text-[13px] text-gray-900" numberOfLines={1}>
                    <Text className="font-bold">{reseller.full_name ?? 'Reseller'}</Text>
                    <Text className="text-gray-400"> · {lastRequest.issue_type} · </Text>
                    <Text className="text-gray-400">{new Date(lastRequest.created_at).toLocaleDateString()}</Text>
                  </Text>
                  <StatusPill status={lastRequest.status} />
                  {userId && <SaveContactButton clientId={userId} contactId={reseller.id} />}
                  <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
                </Pressable>
              ))}
            </>
          )}
        </View>
      </ScrollView>

      <ServiceActionSheet
        category={pickerCategory}
        onClose={() => setPickerCategory(null)}
        onSelect={(action) => {
          if (!pickerCategory) return;
          const category = pickerCategory.label;
          setPickerCategory(null);
          router.push(
            `/(client)/request-details?category=${encodeURIComponent(category)}&action=${encodeURIComponent(action)}&n=${Date.now()}`
          );
        }}
      />
    </>
  );
}
