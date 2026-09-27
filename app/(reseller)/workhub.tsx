// app/(reseller)/workhub.tsx
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Linking, Platform, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { useSupabaseQuery, useSupabaseUpdate } from '../../lib/hooks/useSupabase';
import { useMyEmployees } from '../../lib/hooks/useTechnicianEmployment';
import { PersonAvatar } from '../../lib/components/PersonAvatar';
import { CategoryBadge } from '../../lib/components/CategoryBadge';
import { showAlert, getErrorMessage } from '../../lib/utils/alert';
import { WEB_SIDEBAR_MIN_WIDTH } from '../../lib/components/web/WebSidebarShell';
import type { Profile, ServiceRequest } from '../../types/database.types';

const BLUE = '#2563EB';

/** Jobs still in play - anything finished, paid or cancelled has no place
 * on a board about who is doing what today. */
const LIVE_STATUSES: ServiceRequest['status'][] = ['pending', 'approved', 'assigned', 'in_progress'];

function money(n: number | null | undefined): string {
  return n == null ? '—' : `NPR ${Math.round(Number(n)).toLocaleString()}`;
}

function when(request: ServiceRequest): string {
  const date = request.scheduled_date ?? 'No date';
  return request.scheduled_time ? `${date} · ${request.scheduled_time}` : date;
}

/** Where the job stands, in the words the reseller would use. */
function statusChip(request: ServiceRequest): { label: string; color: string; bg: string } {
  if (request.status === 'in_progress') return { label: 'Working on it', color: '#1D4ED8', bg: '#EFF6FF' };
  if (request.status === 'assigned') return { label: 'Waiting for them to accept', color: '#B45309', bg: '#FFFBEB' };
  if (request.open_to_team) return { label: 'Waiting to be picked up', color: '#047857', bg: '#ECFDF5' };
  return { label: 'Not started', color: '#6B7280', bg: '#F3F4F6' };
}

function JobCard({ request, footer }: { request: ServiceRequest; footer?: React.ReactNode }) {
  const chip = statusChip(request);
  return (
    <View className="rounded-xl border border-gray-200 bg-white p-3">
      <Pressable onPress={() => router.push(`/(reseller)/request/${request.id}` as any)} className="flex-row items-start gap-2.5">
        <CategoryBadge category={request.issue_type} size={30} />
        <View className="flex-1">
          <Text className="text-[13.5px] font-bold text-gray-900" numberOfLines={1}>
            {request.issue_type}
          </Text>
          <Text className="mt-0.5 text-[11.5px] text-gray-500" numberOfLines={1}>
            {request.customer_name ?? 'Customer'} · {when(request)}
          </Text>
          <Text className="mt-0.5 text-[11.5px] text-gray-500" numberOfLines={1}>
            {request.location_data?.address ?? 'No address'}
          </Text>
          <View className="mt-1.5 flex-row flex-wrap items-center" style={{ gap: 6 }}>
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: chip.bg }}>
              <Text className="text-[10.5px] font-bold" style={{ color: chip.color }}>
                {chip.label}
              </Text>
            </View>
            <Text className="text-[11.5px] font-semibold text-gray-700">{money(request.quoted_price)}</Text>
          </View>
        </View>
      </Pressable>
      {footer}
    </View>
  );
}

function Column({
  title,
  subtitle,
  count,
  color,
  tint,
  avatar,
  phone,
  children,
  wide,
}: {
  title: string;
  subtitle: string;
  count: number;
  color: string;
  tint: string;
  avatar?: { name: string | null; photoUrl: string | null };
  phone?: string | null;
  children: React.ReactNode;
  wide: boolean;
}) {
  return (
    <View
      className="rounded-2xl border border-gray-200 bg-gray-50"
      style={wide ? { width: 320, flexGrow: 0, flexShrink: 0 } : undefined}
    >
      <View className="flex-row items-center gap-2.5 rounded-t-2xl px-3.5 py-3" style={{ backgroundColor: tint }}>
        {avatar ? (
          <PersonAvatar name={avatar.name} photoUrl={avatar.photoUrl} size={34} bg="bg-blue-600" />
        ) : (
          <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: color }}>
            <Ionicons name="people" size={16} color="#FFFFFF" />
          </View>
        )}
        <View className="flex-1">
          <Text className="text-[14px] font-bold text-gray-900" numberOfLines={1}>
            {title}
          </Text>
          <Text className="text-[11px] text-gray-600" numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        {!!phone && (
          <Pressable
            onPress={() => Linking.openURL(`tel:${phone}`)}
            hitSlop={6}
            className="h-8 w-8 items-center justify-center rounded-full bg-white"
            accessibilityLabel={`Call ${title}`}
          >
            <Ionicons name="call-outline" size={15} color={color} />
          </Pressable>
        )}
        <View className="h-6 min-w-6 items-center justify-center rounded-full px-1.5" style={{ backgroundColor: color }}>
          <Text className="text-[11.5px] font-extrabold text-white">{count}</Text>
        </View>
      </View>
      <View className="p-3" style={{ gap: 10 }}>{children}</View>
    </View>
  );
}

/** Who is doing what, and what nobody has picked up yet. Assigning still
 * happens on the job's own page (it needs the technician list and the
 * price); this board is the overview that page can't give - and the one
 * place to hand a job to the whole team at once. */
export default function WorkHub() {
  const userId = useAuthStore((state) => state.session?.user.id);
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= WEB_SIDEBAR_MIN_WIDTH;
  const queryClient = useQueryClient();
  const updateRequest = useSupabaseUpdate('service_requests');
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: requests, isLoading } = useSupabaseQuery('service_requests', {
    filters: userId ? { reseller_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!userId,
  });
  const { data: employees } = useMyEmployees(userId);

  const live = useMemo(
    () => (requests ?? []).filter((r) => LIVE_STATUSES.includes(r.status)),
    [requests]
  );

  const byTechnician = useMemo(() => {
    const map = new Map<string, ServiceRequest[]>();
    for (const r of live) {
      if (!r.technician_id) continue;
      const list = map.get(r.technician_id) ?? [];
      list.push(r);
      map.set(r.technician_id, list);
    }
    return map;
  }, [live]);

  const openToTeam = useMemo(() => live.filter((r) => !r.technician_id && r.open_to_team), [live]);
  const unassigned = useMemo(() => live.filter((r) => !r.technician_id && !r.open_to_team), [live]);

  // Technicians holding work who aren't (or are no longer) employees - an
  // outsource technician you offered a job to still belongs on the board.
  const outsideHolders = useMemo(() => {
    const employeeIds = new Set(employees.map((e) => e.profile.id));
    return [...byTechnician.keys()].filter((id) => !employeeIds.has(id));
  }, [byTechnician, employees]);
  const { data: allProfiles } = useSupabaseQuery('profiles', { enabled: outsideHolders.length > 0 });
  const profileById = useMemo(() => new Map((allProfiles ?? []).map((p: Profile) => [p.id, p])), [allProfiles]);

  async function setOpenToTeam(request: ServiceRequest, open: boolean) {
    setBusyId(request.id);
    try {
      await updateRequest.mutateAsync({ id: request.id, values: { open_to_team: open } });
      await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
    } catch (err) {
      showAlert('Could not update', getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const smallButton = (label: string, icon: keyof typeof Ionicons.glyphMap, onPress: () => void, tone: 'blue' | 'ghost') => (
    <Pressable
      onPress={onPress}
      className="h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg disabled:opacity-50"
      style={
        tone === 'blue'
          ? { backgroundColor: BLUE }
          : { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1D5DB' }
      }
    >
      <Ionicons name={icon} size={15} color={tone === 'blue' ? '#FFFFFF' : '#374151'} />
      <Text className={`text-[12.5px] font-semibold ${tone === 'blue' ? 'text-white' : 'text-gray-700'}`}>{label}</Text>
    </Pressable>
  );

  const emptyNote = (text: string) => <Text className="py-2 text-[12px] text-gray-400">{text}</Text>;

  const columns = (
    <>
      <Column
        title="Nobody yet"
        subtitle="Assign someone, or open it to the team"
        count={unassigned.length}
        color="#B45309"
        tint="#FFFBEB"
        wide={wide}
      >
        {unassigned.length === 0
          ? emptyNote('Every job has someone on it.')
          : unassigned.map((r) => (
              <JobCard
                key={r.id}
                request={r}
                footer={
                  <View className="mt-2.5 flex-row" style={{ gap: 8 }}>
                    {smallButton('Assign', 'person-add-outline', () => router.push(`/(reseller)/request/${r.id}` as any), 'ghost')}
                    {smallButton(busyId === r.id ? 'Opening…' : 'Open to team', 'megaphone-outline', () => setOpenToTeam(r, true), 'blue')}
                  </View>
                }
              />
            ))}
      </Column>

      <Column
        title="Open to the team"
        subtitle="First of your employees to accept gets it"
        count={openToTeam.length}
        color="#059669"
        tint="#ECFDF5"
        wide={wide}
      >
        {openToTeam.length === 0
          ? emptyNote('Nothing is waiting to be picked up.')
          : openToTeam.map((r) => (
              <JobCard
                key={r.id}
                request={r}
                footer={
                  <View className="mt-2.5 flex-row" style={{ gap: 8 }}>
                    {smallButton('Assign instead', 'person-add-outline', () => router.push(`/(reseller)/request/${r.id}` as any), 'ghost')}
                    {smallButton(busyId === r.id ? 'Removing…' : 'Take back', 'close-circle-outline', () => setOpenToTeam(r, false), 'ghost')}
                  </View>
                }
              />
            ))}
      </Column>

      {employees.map(({ employment, profile }) => {
        const jobs = byTechnician.get(profile.id) ?? [];
        return (
          <Column
            key={employment.id}
            title={profile.full_name ?? 'Technician'}
            subtitle={
              employment.job_title ??
              `On duty ${employment.work_start_time?.slice(0, 5) ?? '09:00'}–${employment.work_end_time?.slice(0, 5) ?? '17:00'}`
            }
            count={jobs.length}
            color={BLUE}
            tint="#EFF6FF"
            avatar={{ name: profile.full_name, photoUrl: profile.avatar_url }}
            phone={profile.phone}
            wide={wide}
          >
            {jobs.length === 0 ? emptyNote('Free right now.') : jobs.map((r) => <JobCard key={r.id} request={r} />)}
          </Column>
        );
      })}

      {outsideHolders.map((id) => {
        const jobs = byTechnician.get(id) ?? [];
        const profile = profileById.get(id);
        return (
          <Column
            key={id}
            title={profile?.full_name ?? 'Outside technician'}
            subtitle="Not on your team"
            count={jobs.length}
            color="#6B7280"
            tint="#F3F4F6"
            avatar={{ name: profile?.full_name ?? null, photoUrl: profile?.avatar_url ?? null }}
            phone={profile?.phone}
            wide={wide}
          >
            {jobs.map((r) => (
              <JobCard key={r.id} request={r} />
            ))}
          </Column>
        );
      })}
    </>
  );

  const header = (
    <View className="flex-row items-center gap-2.5">
      <View className="flex-1">
        <Text className="text-[15px] font-bold text-gray-900">
          {live.length} job{live.length === 1 ? '' : 's'} in play
        </Text>
        <Text className="mt-0.5 text-[12px] text-gray-500">
          {unassigned.length} waiting for someone · {openToTeam.length} open to the team
        </Text>
      </View>
      <Pressable
        onPress={() => router.push('/(reseller)/employees' as any)}
        className="h-9 flex-row items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3"
      >
        <Ionicons name="people-outline" size={15} color="#374151" />
        <Text className="text-[12.5px] font-semibold text-gray-700">My team</Text>
      </Pressable>
    </View>
  );

  if (isLoading && !requests) {
    return (
      <View className="flex-1 bg-gray-50 p-6">
        <Text className="text-sm text-gray-500">Loading…</Text>
      </View>
    );
  }

  if (wide) {
    return (
      <ScrollView className="flex-1 bg-gray-50" contentContainerStyle={{ padding: 32, paddingTop: 20, gap: 16 }}>
        {header}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
          {columns}
        </ScrollView>
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 14 }}>
      {header}
      {columns}
    </ScrollView>
  );
}
