// app/(reseller)/team-activity.tsx
import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { useMyEmployees } from '../../lib/hooks/useTechnicianEmployment';
import { useTeamJobs, useTeamLocations } from '../../lib/hooks/useTeamActivity';
import { PersonAvatar } from '../../lib/components/PersonAvatar';
import { LocationLine, TeamJobRow } from '../../lib/components/TeamActivity';
import { useWideDetail } from '../../lib/components/detail/DetailLayout';
import { formatDuration } from '../../lib/utils/duration';

const BLUE = '#2563EB';

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function Summary({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <View className="flex-1 rounded-2xl border border-gray-200 bg-white p-3.5" style={{ minWidth: 140 }}>
      <Text className="text-[11px] font-semibold uppercase text-gray-500">{label}</Text>
      <Text className="mt-1 text-2xl font-bold" style={{ color }}>
        {value}
      </Text>
    </View>
  );
}

export default function TeamActivity() {
  const wide = useWideDetail();
  const userId = useAuthStore((state) => state.session?.user.id);
  const { data: employees, isLoading: loadingTeam } = useMyEmployees(userId);
  const { data: jobs, isLoading: loadingJobs } = useTeamJobs(userId, employees.map((e) => e.profile.id));
  const locations = useTeamLocations(userId);
  const [filter, setFilter] = useState<string | null>(null);

  const nameOf = useMemo(() => new Map(employees.map((e) => [e.profile.id, e.profile.full_name ?? 'Technician'])), [employees]);

  const summary = useMemo(() => {
    const today = startOfToday();
    const finished = jobs.filter((j) => j.completedAt && j.workMs != null);
    return {
      active: jobs.filter((j) => j.request.status === 'in_progress').length,
      waiting: jobs.filter((j) => j.request.status === 'assigned').length,
      doneToday: finished.filter((j) => new Date(j.completedAt!).getTime() >= today).length,
      avg: finished.length ? formatDuration(finished.reduce((s, j) => s + j.workMs!, 0) / finished.length) : '-',
    };
  }, [jobs]);

  const shown = filter ? jobs.filter((j) => j.request.technician_id === filter) : jobs;

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      contentContainerStyle={{ padding: wide ? 32 : 16, paddingBottom: 48, gap: 20, maxWidth: 980, width: '100%', alignSelf: 'center' }}
    >
      <View className="flex-row flex-wrap" style={{ gap: 10 }}>
        <Summary label="Working now" value={summary.active} color={BLUE} />
        <Summary label="Waiting to accept" value={summary.waiting} color="#B45309" />
        <Summary label="Done today" value={summary.doneToday} color="#059669" />
        <Summary label="Avg. time per job" value={summary.avg} color="#111827" />
      </View>

      <View>
        <Text className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-gray-400">Where my team is</Text>
        {employees.length === 0 ? (
          <Text className="px-1 text-sm text-gray-500">
            {loadingTeam ? 'Loading…' : 'No employees with a Jageer account yet - invite a technician from Technical Employees.'}
          </Text>
        ) : (
          <View className="flex-row flex-wrap" style={{ gap: 12 }}>
            {employees.map(({ employment, profile }) => {
              const mine = jobs.filter((j) => j.request.technician_id === profile.id);
              const current = mine.find((j) => j.request.status === 'in_progress');
              const offered = mine.find((j) => j.request.status === 'assigned');
              const state = current
                ? { text: `On a job · ${current.request.issue_type}`, color: BLUE }
                : offered
                  ? { text: `Offer pending · ${offered.request.issue_type}`, color: '#B45309' }
                  : { text: 'Free', color: '#059669' };
              return (
                <Pressable
                  key={employment.id}
                  onPress={() => router.push(`/(reseller)/employee/${employment.id}` as any)}
                  className="rounded-2xl border border-gray-200 bg-white p-4 active:bg-gray-50"
                  style={{ flexGrow: 1, flexBasis: 300 }}
                >
                  <View className="flex-row items-center gap-3">
                    <PersonAvatar name={profile.full_name} photoUrl={profile.avatar_url} size={42} bg={profile.avatar_url ? 'bg-blue-600' : 'bg-gray-500'} />
                    <View className="flex-1">
                      <Text className="font-semibold text-gray-900" numberOfLines={1}>
                        {profile.full_name ?? 'Technician'}
                      </Text>
                      <Text className="text-xs font-medium" style={{ color: state.color }} numberOfLines={1}>
                        {state.text}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
                  </View>
                  <View className="mt-3">
                    <LocationLine loc={locations.get(profile.id)} />
                  </View>
                  <Text className="mt-1.5 text-[11px] text-gray-400">
                    Shift {employment.work_start_time?.slice(0, 5)}–{employment.work_end_time?.slice(0, 5)} · {mine.length} job{mine.length === 1 ? '' : 's'} sent
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <Text className="mt-2 px-1 text-[11px] leading-[16px] text-gray-400">
          Locations are shared by the technician's phone only during their shift, while the app is open.
        </Text>
      </View>

      <View>
        <Text className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-gray-400">Jobs sent to my team</Text>
        {employees.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 10 }}>
            {[{ id: null as string | null, name: 'Everyone' }, ...employees.map((e) => ({ id: e.profile.id as string | null, name: nameOf.get(e.profile.id) ?? 'Technician' }))].map((chip) => {
              const on = filter === chip.id;
              return (
                <Pressable
                  key={chip.id ?? 'all'}
                  onPress={() => setFilter(chip.id)}
                  className="rounded-full border px-3.5 py-1.5"
                  style={{ borderColor: on ? BLUE : '#D1D5DB', backgroundColor: on ? BLUE : '#FFFFFF' }}
                >
                  <Text className="text-xs font-semibold" style={{ color: on ? '#FFFFFF' : '#374151' }}>
                    {chip.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <View className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {shown.length === 0 ? (
            <Text className="px-4 py-5 text-sm text-gray-500">
              {loadingJobs ? 'Loading…' : 'No jobs sent to your employees yet.'}
            </Text>
          ) : (
            shown.map((job) => (
              <TeamJobRow key={job.request.id} job={job} technicianName={nameOf.get(job.request.technician_id ?? '')} />
            ))
          )}
        </View>
      </View>
    </ScrollView>
  );
}
