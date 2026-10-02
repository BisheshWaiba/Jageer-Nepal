// app/(reseller)/dashboard.tsx
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { useSupabaseQuery } from '../../lib/hooks/useSupabase';
import { CategoryGrid } from '../../lib/components/CategoryGrid';
import { ServiceActionSheet } from '../../lib/components/ServiceActionSheet';
import {
  usePendingHires,
  useMyEmployees,
  useRespondToHire,
  useLeaveRequests,
  useDecideLeaveRequest,
} from '../../lib/hooks/useTechnicianEmployment';
import { useTeamJobs, useTeamLocations } from '../../lib/hooks/useTeamActivity';
import { useTick } from '../../lib/components/TeamActivity';
import { PersonAvatar } from '../../lib/components/PersonAvatar';
import { buildMember, sortMembers } from '../../lib/utils/teamStatus';
import { showAlert, getErrorMessage } from '../../lib/utils/alert';
import { WEB_SIDEBAR_MIN_WIDTH } from '../../lib/components/web/WebSidebarShell';
import type { Profile, ServiceCategory } from '../../types/database.types';

function initialsOf(name: string | null | undefined) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function HiringSections({ userId }: { userId: string }) {
  const { data: pendingHires } = usePendingHires(userId);
  const { data: employees } = useMyEmployees(userId);
  const respondToHire = useRespondToHire();
  const leaveRequests = useLeaveRequests(userId);
  const decideLeave = useDecideLeaveRequest();

  async function handleLeave(id: string, approve: boolean) {
    try {
      await decideLeave.decide(id, approve);
    } catch (err) {
      showAlert('Could not respond', getErrorMessage(err));
    }
  }

  async function handleRespond(id: string, accept: boolean) {
    try {
      await respondToHire.respond(id, accept);
    } catch (err) {
      showAlert('Could not respond', getErrorMessage(err));
    }
  }

  const { data: jobs } = useTeamJobs(userId, employees.map((e) => e.profile.id));
  const locations = useTeamLocations(userId);
  const now = useTick();
  const members = useMemo(
    () => sortMembers(employees.map((e) => buildMember(e.employment, e.profile, jobs, locations.get(e.profile.id), now))),
    [employees, jobs, locations, now]
  );
  const attention = members.reduce((n, m) => n + m.attention.length, 0);

  return (
    <>
      {leaveRequests.length > 0 && (
        <>
          <Text className="mb-3 mt-3 text-[15px] font-bold text-gray-900">Requests to Leave</Text>
          {leaveRequests.map(({ employment, profile }) => (
            <View key={employment.id} className="mb-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
              <View className="mb-2.5 flex-row items-center gap-3">
                <View className="h-11 w-11 items-center justify-center rounded-full bg-amber-500">
                  <Text className="text-xs font-bold text-white">{initialsOf(profile.full_name)}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-[13.5px] font-bold text-gray-900">{profile.full_name ?? 'Technician'}</Text>
                  <Text className="mt-0.5 text-[11.5px] text-gray-600" numberOfLines={2}>
                    {employment.leave_reason ? `Wants to leave · ${employment.leave_reason}` : 'Wants to leave your team'}
                  </Text>
                </View>
              </View>
              <View className="flex-row gap-2.5">
                <Pressable
                  onPress={() => handleLeave(employment.id, false)}
                  disabled={decideLeave.isPending}
                  className="flex-1 items-center rounded-lg border border-gray-300 bg-white py-2 disabled:opacity-50"
                >
                  <Text className="text-xs font-semibold text-gray-600">Reject</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleLeave(employment.id, true)}
                  disabled={decideLeave.isPending}
                  className="flex-1 items-center rounded-lg bg-red-600 py-2 disabled:opacity-50"
                >
                  <Text className="text-xs font-semibold text-white">Approve</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </>
      )}

      {pendingHires.length > 0 && (
        <>
          <Text className="mb-3 mt-3 text-[15px] font-bold text-gray-900">Hiring Requests</Text>
          {pendingHires.map(({ employment, profile }) => (
            <View key={employment.id} className="mb-2.5 rounded-2xl border border-blue-200 bg-blue-50 p-3.5">
              <View className="mb-2.5 flex-row items-center gap-3">
                <View className="h-11 w-11 items-center justify-center rounded-full bg-blue-600">
                  <Text className="text-xs font-bold text-white">{initialsOf(profile.full_name)}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-[13.5px] font-bold text-gray-900">{profile.full_name ?? 'Technician'}</Text>
                  <Text className="mt-0.5 text-[11.5px] text-gray-500">
                    Wants to work {employment.work_start_time?.slice(0, 5)}–{employment.work_end_time?.slice(0, 5)}
                  </Text>
                </View>
              </View>
              <View className="flex-row gap-2.5">
                <Pressable
                  onPress={() => handleRespond(employment.id, false)}
                  disabled={respondToHire.isPending}
                  className="flex-1 items-center rounded-lg border border-gray-300 py-2 disabled:opacity-50"
                >
                  <Text className="text-xs font-semibold text-gray-600">Reject</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleRespond(employment.id, true)}
                  disabled={respondToHire.isPending}
                  className="flex-1 items-center rounded-lg bg-blue-600 py-2 disabled:opacity-50"
                >
                  <Text className="text-xs font-semibold text-white">Accept</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </>
      )}

      {members.length > 0 && (
        <Pressable
          onPress={() => router.push('/(reseller)/employees' as any)}
          accessibilityRole="button"
          accessibilityLabel="Open team"
          className="mb-2.5 mt-3 rounded-2xl border border-gray-200 bg-white p-4 active:bg-gray-50"
          style={{ gap: 12 }}
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-[15px] font-bold text-gray-900">My team</Text>
            {attention > 0 && (
              <View className="rounded-full bg-red-50 px-2.5 py-0.5">
                <Text className="text-[11px] font-bold text-red-600">{attention} need attention</Text>
              </View>
            )}
          </View>
          <View className="flex-row items-center justify-between">
            <View className="flex-row">
              {members.slice(0, 5).map((m, i) => (
                <View key={m.employment.id} style={{ marginLeft: i === 0 ? 0 : -10 }}>
                  <View className="rounded-full border-2 border-white">
                    <PersonAvatar name={m.profile.full_name} photoUrl={m.profile.avatar_url} size={38} bg={m.profile.avatar_url ? 'bg-blue-600' : 'bg-gray-500'} />
                  </View>
                  <View
                    style={{
                      position: 'absolute',
                      right: 0,
                      bottom: 0,
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      borderWidth: 2,
                      borderColor: '#FFFFFF',
                      backgroundColor: m.state === 'working' ? '#2563EB' : m.state === 'offer' ? '#D97706' : m.state === 'free' ? '#15803D' : '#9CA3AF',
                    }}
                  />
                </View>
              ))}
              {members.length > 5 && (
                <View className="ml-[-10px] h-[38px] w-[38px] items-center justify-center rounded-full border-2 border-white bg-gray-100">
                  <Text className="text-xs font-bold text-gray-600">+{members.length - 5}</Text>
                </View>
              )}
            </View>
            <Text className="text-[13px] text-gray-600">
              {members.filter((m) => m.state === 'working').length} working · {members.filter((m) => m.state === 'free').length} free
            </Text>
          </View>
          <View className="h-11 flex-row items-center justify-center rounded-xl bg-blue-600" style={{ gap: 6 }}>
            <Text className="text-[14px] font-bold text-white">Open team</Text>
            <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
          </View>
        </Pressable>
      )}
    </>
  );
}

export default function ResellerDashboard() {
  const profile = useAuthStore((state) => state.profile);
  const userId = useAuthStore((state) => state.session?.user.id);
  const [search, setSearch] = useState('');
  const [pickerCategory, setPickerCategory] = useState<ServiceCategory | null>(null);

  // A phone browser hitting the website is still Platform.OS === 'web', so
  // that alone can't pick the desktop layout below - its fixed-width search
  // box and 8-column category grid only make sense once there's actually
  // room for them. Same breakpoint as the sidebar shell and the requests
  // pipeline screen.
  const { width: screenWidth } = useWindowDimensions();
  const isWideWeb = Platform.OS === 'web' && screenWidth >= WEB_SIDEBAR_MIN_WIDTH;

  const { data: categories } = useSupabaseQuery('service_categories', {
    filters: { is_active: true },
    orderBy: { column: 'sort_order' },
  });

  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories ?? [];
    return (categories ?? []).filter((c) => c.label.toLowerCase().includes(q));
  }, [categories, search]);

  const { data: technicians } = useSupabaseQuery('profiles', {
    filters: { role: 'technician' },
  });

  const { data: products } = useSupabaseQuery('products', {
    filters: userId ? { seller_id: userId } : {},
    enabled: !!userId,
  });
  const { data: orders } = useSupabaseQuery('orders', {
    filters: userId ? { seller_id: userId } : {},
    enabled: !!userId,
  });
  const { data: myRequests } = useSupabaseQuery('service_requests', {
    filters: userId ? { reseller_id: userId } : {},
    enabled: !!userId,
  });

  const recentlyHiredTechnicians = useMemo(() => {
    const statsByTech = new Map<string, { lastHired: string; count: number }>();
    (myRequests ?? []).forEach((r) => {
      if (!r.technician_id) return;
      const existing = statsByTech.get(r.technician_id);
      statsByTech.set(r.technician_id, {
        lastHired: existing && existing.lastHired > r.created_at ? existing.lastHired : r.created_at,
        count: (existing?.count ?? 0) + 1,
      });
    });
    const techMap = new Map((technicians ?? []).map((t) => [t.id, t]));
    return Array.from(statsByTech.entries())
      .map(([techId, stats]) => ({ tech: techMap.get(techId), ...stats }))
      .filter((entry): entry is { tech: Profile; lastHired: string; count: number } => !!entry.tech)
      .sort((a, b) => new Date(b.lastHired).getTime() - new Date(a.lastHired).getTime())
      .slice(0, 3);
  }, [myRequests, technicians]);

  const appCustomerCount = useMemo(
    () => (myRequests ?? []).filter((r) => r.origin === 'app').length,
    [myRequests]
  );
  const ownCustomerCount = useMemo(
    () => (myRequests ?? []).filter((r) => r.origin === 'reseller').length,
    [myRequests]
  );

  const revenue = useMemo(
    () =>
      (orders ?? [])
        .filter((o) => o.status !== 'cancelled')
        .reduce((sum, o) => sum + Number(o.total_amount), 0),
    [orders]
  );
  const deadStock = useMemo(() => (products ?? []).filter((p) => p.is_dead_stock), [products]);

  const actionSheet = (
    <ServiceActionSheet
      category={pickerCategory}
      onClose={() => setPickerCategory(null)}
      onSelect={(action) => {
        if (!pickerCategory) return;
        const category = pickerCategory.label;
        setPickerCategory(null);
        router.push(
          `/(reseller)/request-details?category=${encodeURIComponent(category)}&action=${encodeURIComponent(action)}&n=${Date.now()}`
        );
      }}
    />
  );

  // Wide web gets its own reflowed arrangement (wider category grid, a
  // right rail for secondary content) instead of one long mobile-width
  // scroll - see WebSidebarShell. Kept as a fully separate branch below
  // rather than one JSX tree with conditional classes, so the native/narrow
  // layout stays byte-for-byte what it already was.
  if (isWideWeb) {
    const needTechnicianCard = (
      <Pressable
        onPress={() => router.push('/(reseller)/new-request?from=dashboard')}
        className="rounded-2xl bg-blue-50 p-4"
      >
        <Text className="text-[13.5px] font-bold text-blue-700">Need a technician?</Text>
        <Text className="mb-2.5 mt-0.5 text-xs text-blue-600">Request one directly in seconds</Text>
        <View className="self-start rounded-full bg-blue-600 px-4 py-1.5">
          <Text className="text-xs font-bold text-white">Request</Text>
        </View>
      </Pressable>
    );

    return (
      <>
        <ScrollView className="flex-1 bg-gray-50" contentContainerStyle={{ paddingBottom: 40 }}>
          <View className="px-8 pb-2 pt-6">
            <View className="mb-5 flex-row items-center justify-between">
              <Text className="text-2xl font-extrabold text-gray-900">
                Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}
              </Text>
              <View className="w-80 flex-row items-center rounded-xl border border-gray-200 bg-white px-4 py-2.5">
                <Ionicons name="search" size={16} color="#9CA3AF" />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search for services..."
                  placeholderTextColor="#9CA3AF"
                  className="ml-2 flex-1 text-sm text-gray-900"
                />
              </View>
            </View>

            <View className="flex-row gap-6">
              <View className="flex-1" style={{ minWidth: 0 }}>
                <Text className="mb-3 text-[15px] font-bold text-gray-900">Browse by category</Text>
                <CategoryGrid categories={filteredCategories} onSelect={setPickerCategory} columns={8} />

                {recentlyHiredTechnicians.length > 0 && (
                  <>
                    <Text className="mb-3 mt-2 text-[15px] font-bold text-gray-900">Outsource Technicians</Text>
                    <View className="mb-2 flex-row flex-wrap gap-3">
                      {recentlyHiredTechnicians.map(({ tech, count }) => (
                        <View
                          key={tech.id}
                          className="flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3.5"
                          style={{ width: '32%' }}
                        >
                          <View className="h-11 w-11 items-center justify-center rounded-full bg-teal-600">
                            <Text className="text-xs font-bold text-white">{initialsOf(tech.full_name)}</Text>
                          </View>
                          <View className="flex-1">
                            <Pressable onPress={() => router.push(`/(reseller)/technician/${tech.id}`)}>
                              <Text className="text-[13.5px] font-bold text-teal-700 underline">
                                {tech.full_name ?? 'Technician'}
                              </Text>
                            </Pressable>
                            <Text className="mt-0.5 text-[11.5px] text-gray-400">
                              {tech.city ?? 'Nepal'} · {count} job{count === 1 ? '' : 's'} together
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  </>
                )}

                {userId && <HiringSections userId={userId} />}
              </View>

              <View className="w-72 gap-4">
                {(appCustomerCount > 0 || ownCustomerCount > 0) && (
                  <View className="rounded-2xl border border-gray-100 bg-white p-4">
                    <Text className="mb-2.5 text-[13px] font-bold text-gray-900">Where your customers come from</Text>
                    <View className="flex-row gap-2.5">
                      <View className="flex-1 rounded-xl bg-gray-50 p-3">
                        <Text className="text-lg font-bold text-blue-600">{appCustomerCount}</Text>
                        <Text className="text-[10.5px] text-gray-500">From the app</Text>
                      </View>
                      <View className="flex-1 rounded-xl bg-gray-50 p-3">
                        <Text className="text-lg font-bold text-purple-700">{ownCustomerCount}</Text>
                        <Text className="text-[10.5px] text-gray-500">Your own</Text>
                      </View>
                    </View>
                  </View>
                )}

                <View className="rounded-2xl border border-gray-100 bg-white p-4">
                  <Text className="mb-2 text-[13px] font-bold text-gray-900">Shop performance</Text>
                  <Text className="text-xl font-bold text-blue-600">NPR {revenue.toLocaleString()}</Text>
                  <Text className="text-xs text-gray-400">Revenue</Text>
                  {deadStock.length > 0 && (
                    <Text className="mt-2 text-xs text-gray-500">{deadStock.length} item(s) flagged as dead stock</Text>
                  )}
                </View>

                {needTechnicianCard}
              </View>
            </View>
          </View>
        </ScrollView>

        {actionSheet}
      </>
    );
  }

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
            onPress={() => router.push('/(reseller)/new-request?from=dashboard')}
            className="mb-5 flex-row items-center justify-between rounded-2xl bg-orange-500 px-4 py-3.5"
          >
            <View>
              <Text className="text-[14.5px] font-bold text-white">Need a technician?</Text>
              <Text className="mt-0.5 text-xs text-orange-100">Request one directly in seconds</Text>
            </View>
            <View className="rounded-full bg-white px-4 py-2">
              <Text className="text-xs font-bold text-orange-600">Request</Text>
            </View>
          </Pressable>

          <Text className="mb-3 text-[15px] font-bold text-gray-900">Browse by category</Text>
          <CategoryGrid categories={filteredCategories} onSelect={setPickerCategory} />

          {recentlyHiredTechnicians.length > 0 && (
            <>
              <Text className="mb-3 mt-3 text-[15px] font-bold text-gray-900">Outsource Technicians</Text>
              {recentlyHiredTechnicians.map(({ tech, count }) => (
                <View
                  key={tech.id}
                  className="mb-2.5 flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3.5"
                >
                  <View className="h-11 w-11 items-center justify-center rounded-full bg-teal-600">
                    <Text className="text-xs font-bold text-white">{initialsOf(tech.full_name)}</Text>
                  </View>
                  <View className="flex-1">
                    <Pressable onPress={() => router.push(`/(reseller)/technician/${tech.id}`)}>
                      <Text className="text-[13.5px] font-bold text-teal-700 underline">
                        {tech.full_name ?? 'Technician'}
                      </Text>
                    </Pressable>
                    <Text className="mt-0.5 text-[11.5px] text-gray-400">
                      {tech.city ?? 'Nepal'} · {count} job{count === 1 ? '' : 's'} together
                    </Text>
                  </View>
                </View>
              ))}
            </>
          )}

          {userId && <HiringSections userId={userId} />}

          {(appCustomerCount > 0 || ownCustomerCount > 0) && (
            <>
              <Text className="mb-3 mt-5 text-[15px] font-bold text-gray-900">Where your customers come from</Text>
              <View className="mb-2.5 flex-row gap-3">
                <View className="flex-1 rounded-xl bg-white p-5">
                  <Text className="text-2xl font-bold text-orange-600">{appCustomerCount}</Text>
                  <Text className="text-sm text-gray-500">From the app</Text>
                </View>
                <View className="flex-1 rounded-xl bg-white p-5">
                  <Text className="text-2xl font-bold text-purple-700">{ownCustomerCount}</Text>
                  <Text className="text-sm text-gray-500">Your own customers</Text>
                </View>
              </View>
            </>
          )}

          <Text className="mb-3 mt-5 text-[15px] font-bold text-gray-900">Shop performance</Text>
          <View className="mb-2.5 rounded-xl bg-white p-5">
            <Text className="text-2xl font-bold text-orange-600">NPR {revenue.toLocaleString()}</Text>
            <Text className="text-sm text-gray-500">Revenue</Text>
          </View>

          {deadStock.length > 0 && (
            <Text className="mb-2.5 text-sm text-gray-500">{deadStock.length} item(s) flagged as dead stock</Text>
          )}
        </View>
      </ScrollView>

      {actionSheet}
    </>
  );
}
