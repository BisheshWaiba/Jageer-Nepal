// lib/components/team/TeamActivityView.tsx
// The "Activity" half of the reseller Team hub: what needs action, who is
// where, and the jobs sent to the team.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useMyEmployees } from '../../hooks/useTechnicianEmployment';
import { useTeamJobs, useTeamLocations, type TeamJob } from '../../hooks/useTeamActivity';
import { PersonAvatar } from '../PersonAvatar';
import { AssignJobSheet } from '../AssignJobToEmployee';
import { useWideDetail } from '../detail/DetailLayout';
import { TeamJobRow, locationState, useTick } from '../TeamActivity';
import { StateChip, SegmentedSwitch, FilterChip } from './TeamParts';
import { buildMember, sortMembers, STATE_LABEL, type Member, type MemberState } from '../../utils/teamStatus';
import { formatDuration } from '../../utils/duration';

const BLUE = '#2563EB';
const HISTORY_PAGE = 30;

function GroupLabel({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <Text className="mb-2 px-1 text-[11px] font-bold uppercase text-gray-500" style={{ letterSpacing: 0.6 }}>
      {children}
      {count != null ? `  ${count}` : ''}
    </Text>
  );
}

function List({ children }: { children: ReactNode }) {
  return <View className="overflow-hidden rounded-2xl border border-gray-200 bg-white">{children}</View>;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function sentAt(job: TeamJob) {
  return job.request.assigned_at ?? job.request.created_at;
}

function MemberRow({
  member,
  last,
  now,
  onAssign,
}: {
  member: Member;
  last: boolean;
  now: number;
  onAssign: (m: Member) => void;
}) {
  const wide = useWideDetail();
  const { profile, employment, state, current, offered, loc, attention } = member;
  const name = profile.full_name ?? 'Technician';
  const loca = locationState(loc, now);

  const doing =
    state === 'working' && current
      ? `${current.request.issue_type} · ${current.acceptedAt ? `${formatDuration(now - new Date(current.acceptedAt).getTime())} in` : 'started'}`
      : state === 'offer' && offered
        ? `${offered.request.issue_type} · waiting ${formatDuration(now - new Date(sentAt(offered)).getTime())}`
        : state === 'free'
          ? 'Nothing assigned'
          : `Shift ${employment.work_start_time?.slice(0, 5)}–${employment.work_end_time?.slice(0, 5)}`;

  return (
    <Pressable
      onPress={() => router.push(`/(reseller)/employee/${employment.id}` as any)}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${STATE_LABEL[state]}. Open`}
      className={`flex-row items-center gap-3 px-4 py-3.5 active:bg-gray-50 ${last ? '' : 'border-b border-gray-100'}`}
    >
      <PersonAvatar name={profile.full_name} photoUrl={profile.avatar_url} size={44} bg={profile.avatar_url ? 'bg-blue-600' : 'bg-gray-500'} />
      <View className="flex-1" style={{ gap: 3 }}>
        <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
          <Text className="text-[14.5px] font-bold text-gray-900" numberOfLines={1}>
            {name}
          </Text>
          <StateChip state={state} />
        </View>
        <Text className="text-[13px] text-gray-600" numberOfLines={1}>
          {doing}
        </Text>
        <View className="flex-row items-center" style={{ gap: 5 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: loca.color }} />
          <Text className="text-[11.5px] font-medium" style={{ color: loca.color }} numberOfLines={1}>
            {loca.label}
          </Text>
          {attention.length > 0 && (
            <Text className="text-[11.5px] font-bold text-red-600" numberOfLines={1}>
              {'  ·  Needs attention'}
            </Text>
          )}
        </View>
      </View>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        {state === 'free' && (
          <Pressable
            onPress={() => onAssign(member)}
            hitSlop={4}
            accessibilityLabel={`Assign a job to ${name}`}
            className="h-10 flex-row items-center justify-center rounded-xl px-3"
            style={{ backgroundColor: BLUE, gap: 6 }}
          >
            <Ionicons name="paper-plane" size={14} color="#FFFFFF" />
            {wide && <Text className="text-xs font-bold text-white">Assign job</Text>}
          </Pressable>
        )}
        {!!profile.phone && (
          <Pressable
            onPress={() => Linking.openURL(`tel:${profile.phone}`)}
            hitSlop={4}
            accessibilityLabel={`Call ${name}`}
            className="h-10 w-10 items-center justify-center rounded-full bg-blue-50"
          >
            <Ionicons name="call-outline" size={18} color={BLUE} />
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

function AttentionStrip({ members }: { members: Member[] }) {
  const items = members.flatMap((m) => m.attention.map((a) => ({ a, m })));
  if (items.length === 0) return null;
  return (
    <View className="rounded-2xl border border-amber-200 bg-amber-50">
      <View className="flex-row items-center gap-2 px-4 pb-1 pt-3.5">
        <Ionicons name="alert-circle" size={17} color="#B45309" />
        <Text className="text-[14px] font-bold text-amber-900">Needs attention · {items.length}</Text>
      </View>
      {items.map(({ a, m }, i) => (
        <View
          key={a.key}
          className={`flex-row items-center gap-3 px-4 py-3 ${i === items.length - 1 ? '' : 'border-b border-amber-100'}`}
        >
          <View className="flex-1">
            <Text className="text-[13.5px] font-semibold text-gray-900">{a.title}</Text>
            <Text className="text-xs text-amber-900/70" numberOfLines={1}>
              {a.detail}
            </Text>
          </View>
          {!!m.profile.phone && (
            <Pressable
              onPress={() => Linking.openURL(`tel:${m.profile.phone}`)}
              accessibilityLabel={`Call ${m.profile.full_name ?? 'technician'}`}
              className="h-10 w-10 items-center justify-center rounded-full bg-white"
            >
              <Ionicons name="call-outline" size={17} color={BLUE} />
            </Pressable>
          )}
          <Pressable
            onPress={() =>
              router.push(
                (a.requestId ? `/(reseller)/request/${a.requestId}` : `/(reseller)/employee/${m.employment.id}`) as any
              )
            }
            accessibilityLabel={a.requestId ? 'Open job' : 'Open employee'}
            className="h-10 items-center justify-center rounded-xl border border-amber-300 bg-white px-3"
          >
            <Text className="text-xs font-bold text-amber-900">{a.requestId ? 'Open job' : 'Open'}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

export function TeamActivityView({ onOpenPeople, onAttentionCount }: { onOpenPeople: () => void; onAttentionCount?: (n: number) => void }) {
  const wide = useWideDetail();
  const userId = useAuthStore((state) => state.session?.user.id);
  const { data: employees, isLoading: loadingTeam } = useMyEmployees(userId);
  const { data: jobs, isLoading: loadingJobs } = useTeamJobs(userId, employees.map((e) => e.profile.id));
  const locations = useTeamLocations(userId);
  const now = useTick();

  const [stateFilter, setStateFilter] = useState<MemberState | null>(null);
  const [view, setView] = useState<'today' | 'history'>('today');
  const [who, setWho] = useState<string | null>(null);
  const [shown, setShown] = useState(HISTORY_PAGE);
  const [assignTo, setAssignTo] = useState<{ id: string; name: string } | null>(null);

  const members = useMemo(
    () => sortMembers(employees.map((e) => buildMember(e.employment, e.profile, jobs, locations.get(e.profile.id), now))),
    [employees, jobs, locations, now]
  );
  const attentionCount = members.reduce((n, m) => n + m.attention.length, 0);
  useEffect(() => {
    onAttentionCount?.(attentionCount);
  }, [attentionCount, onAttentionCount]);

  const nameOf = useMemo(() => new Map(employees.map((e) => [e.profile.id, e.profile.full_name ?? 'Technician'])), [employees]);
  const counts = useMemo(() => {
    const c: Record<MemberState, number> = { working: 0, offer: 0, free: 0, off: 0 };
    members.forEach((m) => (c[m.state] += 1));
    return c;
  }, [members]);
  const board = stateFilter ? members.filter((m) => m.state === stateFilter) : members;

  const todayStart = new Date(now).setHours(0, 0, 0, 0);
  const waiting = jobs.filter((j) => j.request.status === 'assigned');
  const working = jobs.filter((j) => j.request.status === 'in_progress');
  const doneToday = jobs.filter((j) => j.completedAt && new Date(j.completedAt).getTime() >= todayStart);

  const history = useMemo(() => (who ? jobs.filter((j) => j.request.technician_id === who) : jobs), [jobs, who]);
  const historyGroups = useMemo(() => {
    const groups: { label: string; items: TeamJob[] }[] = [];
    for (const j of history.slice(0, shown)) {
      const label = dayLabel(sentAt(j));
      const g = groups[groups.length - 1];
      if (g && g.label === label) g.items.push(j);
      else groups.push({ label, items: [j] });
    }
    return groups;
  }, [history, shown]);

  if (employees.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 px-8">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-blue-50">
          <Ionicons name="people-outline" size={26} color={BLUE} />
        </View>
        <Text className="mt-4 text-center text-[17px] font-extrabold text-gray-900">
          {loadingTeam ? 'Loading your team…' : 'No one to track yet'}
        </Text>
        {!loadingTeam && (
          <>
            <Text className="mt-1.5 max-w-[320px] text-center text-sm text-gray-500">
              Activity appears here once a technician with a Jageer account has accepted your invite.
            </Text>
            <Pressable onPress={onOpenPeople} className="mt-5 h-12 items-center justify-center rounded-xl bg-blue-600 px-6">
              <Text className="text-[15px] font-bold text-white">Invite a technician</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const jobList = (items: TeamJob[], compact = false) =>
    items.map((job, i) => (
      <TeamJobRow
        key={job.request.id}
        job={job}
        compact={compact}
        last={i === items.length - 1}
        technicianName={nameOf.get(job.request.technician_id ?? '')}
      />
    ));

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      contentContainerStyle={{ padding: wide ? 32 : 16, paddingBottom: 48, gap: 24, maxWidth: 980, width: '100%', alignSelf: 'center' }}
    >
      <AttentionStrip members={members} />

      <View>
        <GroupLabel>Team now</GroupLabel>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
          <FilterChip label="Everyone" count={members.length} on={stateFilter === null} onPress={() => setStateFilter(null)} />
          {(['working', 'offer', 'free', 'off'] as MemberState[])
            .filter((s) => counts[s] > 0)
            .map((s) => (
              <FilterChip key={s} label={STATE_LABEL[s]} count={counts[s]} on={stateFilter === s} onPress={() => setStateFilter(stateFilter === s ? null : s)} />
            ))}
        </ScrollView>
        <List>
          {board.map((m, i) => (
            <MemberRow
              key={m.employment.id}
              member={m}
              now={now}
              last={i === board.length - 1}
              onAssign={(mm) => setAssignTo({ id: mm.profile.id, name: mm.profile.full_name ?? 'Technician' })}
            />
          ))}
        </List>
        <Text className="mt-2 px-1 text-[11px] leading-[16px] text-gray-500">
          Locations are shared by the technician's phone only during their shift, while the app is open.
        </Text>
      </View>

      <View style={{ gap: 14 }}>
        <SegmentedSwitch
          value={view}
          onChange={setView}
          options={[
            { key: 'today', label: 'Today' },
            { key: 'history', label: 'History' },
          ]}
        />

        {view === 'today' ? (
          loadingJobs ? (
            <Text className="px-1 text-sm text-gray-500">Loading…</Text>
          ) : waiting.length + working.length + doneToday.length === 0 ? (
            <Text className="px-1 text-sm text-gray-500">Nothing on the go today. Jobs you send to the team show up here.</Text>
          ) : (
            <>
              {waiting.length > 0 && (
                <View>
                  <GroupLabel count={waiting.length}>Waiting to accept</GroupLabel>
                  <List>{jobList(waiting)}</List>
                </View>
              )}
              {working.length > 0 && (
                <View>
                  <GroupLabel count={working.length}>In progress</GroupLabel>
                  <List>{jobList(working)}</List>
                </View>
              )}
              {doneToday.length > 0 && (
                <View>
                  <GroupLabel count={doneToday.length}>Done today</GroupLabel>
                  <List>{jobList(doneToday, true)}</List>
                </View>
              )}
            </>
          )
        ) : (
          <>
            {employees.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                <FilterChip label="Everyone" on={who === null} onPress={() => setWho(null)} />
                {employees.map((e) => (
                  <FilterChip key={e.profile.id} label={nameOf.get(e.profile.id) ?? 'Technician'} on={who === e.profile.id} onPress={() => setWho(e.profile.id)} />
                ))}
              </ScrollView>
            )}
            {history.length === 0 ? (
              <Text className="px-1 text-sm text-gray-500">{loadingJobs ? 'Loading…' : 'No jobs sent yet.'}</Text>
            ) : (
              <>
                {historyGroups.map((g) => (
                  <View key={g.label}>
                    <GroupLabel count={g.items.length}>{g.label}</GroupLabel>
                    <List>{jobList(g.items, true)}</List>
                  </View>
                ))}
                {history.length > shown && (
                  <Pressable
                    onPress={() => setShown((n) => n + HISTORY_PAGE)}
                    className="h-11 items-center justify-center rounded-xl border border-gray-200 bg-white"
                  >
                    <Text className="text-[13px] font-bold text-gray-700">Show {Math.min(HISTORY_PAGE, history.length - shown)} more</Text>
                  </Pressable>
                )}
              </>
            )}
          </>
        )}
      </View>

      <AssignJobSheet
        visible={!!assignTo}
        technicianId={assignTo?.id ?? ''}
        technicianName={assignTo?.name ?? ''}
        onClose={() => setAssignTo(null)}
      />
    </ScrollView>
  );
}
