// app/(reseller)/workhub.tsx
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Linking, Platform, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { useSupabaseQuery, useSupabaseUpdate } from '../../lib/hooks/useSupabase';
import { useMyEmployees } from '../../lib/hooks/useTechnicianEmployment';
import { useRankedTechnicians } from '../../lib/hooks/useTechnicianRanking';
import { assignTechnician, showJobSentAlert } from '../../lib/utils/assignTechnician';
import { PersonAvatar } from '../../lib/components/PersonAvatar';
import { CategoryBadge } from '../../lib/components/CategoryBadge';
import { showAlert, getErrorMessage } from '../../lib/utils/alert';
import { exportWorkPdf, exportWorkXlsx, type WorkRecordRow } from '../../lib/utils/exportWorkRecord';
import { WEB_SIDEBAR_MIN_WIDTH } from '../../lib/components/web/WebSidebarShell';
import type { Profile, ServiceRequest } from '../../types/database.types';

const BLUE = '#2563EB';

/** Jobs still in play - anything finished, paid or cancelled has no place
 * on a board about who is doing what today. */
const LIVE_STATUSES: ServiceRequest['status'][] = ['pending', 'approved', 'assigned', 'in_progress'];

/** The same buckets the Requests tab uses, so a job is in the state here
 * that it is in there - and "All" is every job either page knows about. */
type Filter = 'active' | 'completed' | 'paid' | 'cancelled' | 'all';

const FILTERS: { key: Filter; label: string; color: string }[] = [
  { key: 'active', label: 'Still to do', color: '#2563EB' },
  { key: 'completed', label: 'Completed', color: '#16A34A' },
  { key: 'paid', label: 'Paid', color: '#047857' },
  { key: 'cancelled', label: 'Cancelled', color: '#6B7280' },
  { key: 'all', label: 'All', color: '#374151' },
];

function matchesFilter(request: ServiceRequest, filter: Filter): boolean {
  switch (filter) {
    case 'active':
      return LIVE_STATUSES.includes(request.status);
    case 'completed':
      return request.status === 'resolved' && request.payment_status !== 'paid';
    case 'paid':
      return request.status === 'resolved' && request.payment_status === 'paid';
    case 'cancelled':
      return request.status === 'cancelled';
    case 'all':
      return true;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Still open, so it can still be handed to someone. A finished or
 * cancelled job only gets a View. */
const isOpenJob = (request: ServiceRequest) => LIVE_STATUSES.includes(request.status);

/** Plain words for the saved record - "in_progress" is the database's
 * word, not one a reader wants in a spreadsheet. */
const STATUS_WORDS: Record<ServiceRequest['status'], string> = {
  pending: 'Not started',
  quoted: 'Quote sent',
  approved: 'Approved',
  assigned: 'Waiting to accept',
  in_progress: 'Working on it',
  resolved: 'Finished',
  cancelled: 'Cancelled',
};

/** When the job was meant to happen: its appointment if it has one, else
 * when it was raised. */
function dueAt(request: ServiceRequest): number {
  if (request.scheduled_date) {
    const time = request.scheduled_time?.slice(0, 5) ?? '23:59';
    const parsed = new Date(`${request.scheduled_date}T${time}`).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  return new Date(request.created_at).getTime();
}

/** Still open a day after it should have been done - the jobs worth
 * chasing, which is what this page is for. */
function isOverdue(request: ServiceRequest): boolean {
  return Date.now() - dueAt(request) > DAY_MS;
}

function money(n: number | null | undefined): string {
  return n == null ? '—' : `NPR ${Math.round(Number(n)).toLocaleString()}`;
}

function when(request: ServiceRequest): string {
  const date = request.scheduled_date ?? 'No date';
  return request.scheduled_time ? `${date} · ${request.scheduled_time}` : date;
}

/** Where the job stands, in the words the reseller would use. */
function statusChip(request: ServiceRequest): { label: string; color: string; bg: string } {
  if (request.status === 'cancelled') return { label: 'Cancelled', color: '#6B7280', bg: '#F3F4F6' };
  if (request.status === 'resolved') {
    return request.payment_status === 'paid'
      ? { label: 'Done & paid', color: '#047857', bg: '#ECFDF5' }
      : { label: 'Completed', color: '#16A34A', bg: '#F0FDF4' };
  }
  if (request.status === 'in_progress') return { label: 'Working on it', color: '#1D4ED8', bg: '#EFF6FF' };
  if (request.status === 'assigned') return { label: 'Waiting for them to accept', color: '#B45309', bg: '#FFFBEB' };
  if (request.open_to_team) return { label: 'Waiting to be picked up', color: '#047857', bg: '#ECFDF5' };
  return { label: 'Not started', color: '#6B7280', bg: '#F3F4F6' };
}

function OverdueChip() {
  return (
    <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#FEF2F2' }}>
      <Text className="text-[10.5px] font-bold" style={{ color: '#B91C1C' }}>
        Overdue
      </Text>
    </View>
  );
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
            {isOverdue(request) && <OverdueChip />}
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
      style={wide ? { minWidth: 320, flexBasis: 320, flexGrow: 1, flexShrink: 0 } : undefined}
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

const PAY_CHIP: Record<string, { label: string; color: string; bg: string }> = {
  paid: { label: 'Paid', color: '#047857', bg: '#ECFDF5' },
  partial: { label: 'Part paid', color: '#B45309', bg: '#FFFBEB' },
  unpaid: { label: 'Unpaid', color: '#B91C1C', bg: '#FEF2F2' },
};

function Chip({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View className="self-start rounded-full px-2 py-0.5" style={{ backgroundColor: bg }}>
      <Text className="text-[10.5px] font-bold" style={{ color }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

interface PickPerson {
  id: string;
  name: string | null;
  photoUrl: string | null;
  line: string;
  free?: boolean;
}

/** Who should do this job. Two lists, because they are two decisions: the
 * people who work for you (pick one, it goes straight to them) and the
 * freelancers nearby (sending one is a request they can turn down). */
function AssignSheet({
  request,
  mode,
  people,
  loading,
  onPick,
  onClose,
  busy,
}: {
  request: ServiceRequest | null;
  mode: 'staff' | 'freelance';
  people: PickPerson[];
  loading: boolean;
  onPick: (person: PickPerson) => void;
  onClose: () => void;
  busy: boolean;
}) {
  if (!request) return null;
  const staff = mode === 'staff';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/50 px-4" onPress={onClose}>
        <Pressable onPress={() => {}} className="w-full overflow-hidden rounded-2xl bg-white" style={{ maxWidth: 420, maxHeight: '85%' }}>
          <View className="flex-row items-center gap-2.5 px-5 py-4" style={{ backgroundColor: staff ? BLUE : '#6D28D9' }}>
            <View className="flex-1">
              <Text className="text-[16px] font-bold text-white">
                {staff ? 'Give this to your staff' : 'Request a freelance technician'}
              </Text>
              <Text className="mt-0.5 text-[11.5px] text-white/85" numberOfLines={1}>
                {request.issue_type} · {request.customer_name ?? 'Customer'}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color="#FFFFFF" />
            </Pressable>
          </View>

          <ScrollView>
            {loading ? (
              <Text className="px-5 py-5 text-sm text-gray-500">Loading…</Text>
            ) : people.length === 0 ? (
              <Text className="px-5 py-5 text-sm text-gray-500">
                {staff
                  ? 'Nobody works for you yet - add your team under My team.'
                  : 'No freelance technician is free right now.'}
              </Text>
            ) : (
              people.map((person, i) => (
                <Pressable
                  key={person.id}
                  onPress={() => !busy && onPick(person)}
                  disabled={busy}
                  className={`flex-row items-center gap-3 px-5 py-3.5 disabled:opacity-60 ${i === people.length - 1 ? '' : 'border-b border-gray-100'}`}
                >
                  <PersonAvatar name={person.name} photoUrl={person.photoUrl} size={36} bg={staff ? 'bg-blue-600' : 'bg-purple-600'} />
                  <View className="flex-1">
                    <Text className="text-[14px] font-semibold text-gray-900" numberOfLines={1}>
                      {person.name ?? 'Technician'}
                    </Text>
                    <Text className="text-[11.5px] text-gray-500" numberOfLines={1}>
                      {person.line}
                    </Text>
                  </View>
                  <Text className="text-[12px] font-semibold" style={{ color: staff ? BLUE : '#6D28D9' }}>
                    {staff ? 'Assign' : 'Request'}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>

          <Text className="border-t border-gray-100 px-5 py-3 text-[11px] leading-[16px] text-gray-500">
            {staff
              ? 'It rings on their phone; they accept or reject it.'
              : "A freelancer isn't on your team - they get the same ringing request and can turn it down."}
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The list the Work Hub opens on: one line per job with the few things
 * usually being checked - what it is, who it's for, who has it, and
 * whether it's been paid. The board (who's carrying what) is a tap away
 * rather than the first thing in the way. */
function JobSheet({
  jobs,
  technicianName,
  onAssign,
  onRequest,
  busyId,
  wide,
  expanded,
}: {
  jobs: ServiceRequest[];
  technicianName: (id: string) => string;
  onAssign: (request: ServiceRequest) => void;
  onRequest: (request: ServiceRequest) => void;
  busyId: string | null;
  wide: boolean;
  /** Full screen: nothing is cut short, however long the job's name is. */
  expanded?: boolean;
}) {
  const cell = 'px-3 py-2.5 border-r border-gray-100';
  const head = (label: string, style: object) => (
    <Text className={`${cell} text-[11px] font-bold uppercase tracking-wide text-gray-400`} style={style}>
      {label}
    </Text>
  );

  if (jobs.length === 0) {
    return (
      <View className="items-center rounded-2xl border border-dashed border-gray-200 bg-white py-10">
        <Ionicons name="clipboard-outline" size={26} color="#D1D5DB" />
        <Text className="mt-2 text-sm text-gray-500">No jobs in play right now.</Text>
      </View>
    );
  }

  if (!wide) {
    return (
      <View style={{ gap: 10 }}>
        {jobs.map((r) => {
          const pay = PAY_CHIP[r.payment_status] ?? PAY_CHIP.unpaid;
          const chip = statusChip(r);
          return (
            <View key={r.id} className="rounded-2xl border border-gray-200 bg-white p-3.5">
              <Pressable onPress={() => router.push(`/(reseller)/request/${r.id}` as any)}>
                <Text className="text-[14px] font-bold text-gray-900" numberOfLines={expanded ? undefined : 1}>
                  {r.issue_type}
                </Text>
                <Text className="mt-0.5 text-[12px] text-gray-600" numberOfLines={expanded ? undefined : 1}>
                  {r.customer_name ?? 'Customer'}
                  {r.customer_phone ? ` · ${r.customer_phone}` : ''}
                </Text>
                <View className="mt-1.5 flex-row flex-wrap items-center" style={{ gap: 6 }}>
                  <Chip {...chip} />
                  {isOverdue(r) && <OverdueChip />}
                  <Chip {...pay} />
                  <Text className="text-[11.5px] text-gray-500">
                    {r.technician_id ? technicianName(r.technician_id) : 'Nobody yet'}
                  </Text>
                </View>
              </Pressable>
              <View className="mt-2.5 flex-row" style={{ gap: 8 }}>
                {!!r.customer_phone && (
                  <Pressable
                    onPress={() => Linking.openURL(`tel:${r.customer_phone}`)}
                    className="h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white"
                    accessibilityLabel="Call customer"
                  >
                    <Ionicons name="call-outline" size={15} color={BLUE} />
                  </Pressable>
                )}
                <Pressable
                  onPress={() => onAssign(r)}
                  className="h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg"
                  style={{ backgroundColor: BLUE }}
                >
                  <Ionicons name="person-add-outline" size={15} color="#FFFFFF" />
                  <Text className="text-[12.5px] font-semibold text-white">
                    {r.technician_id ? 'Reassign' : 'Assign'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onRequest(r)}
                  className="h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border bg-white"
                  style={{ borderColor: '#DDD6FE' }}
                >
                  <Ionicons name="paper-plane-outline" size={15} color="#6D28D9" />
                  <Text className="text-[12.5px] font-semibold" style={{ color: '#6D28D9' }}>
                    Request
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <View className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <View className="flex-row border-b border-gray-200 bg-gray-50">
        {head('Job', { flex: 1 })}
        {head('Customer', { width: 220 })}
        {head('With', { width: 150 })}
        {head('Status', { width: 170 })}
        {head('Payment', { width: 100 })}
        <Text className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-gray-400" style={{ width: 210 }}>
          Assign
        </Text>
      </View>
      {jobs.map((r) => {
        const pay = PAY_CHIP[r.payment_status] ?? PAY_CHIP.unpaid;
        return (
          <View key={r.id} className="flex-row items-center border-b border-gray-100">
            <Pressable
              onPress={() => router.push(`/(reseller)/request/${r.id}` as any)}
              className={cell}
              style={{ flex: 1 }}
            >
              <Text className="text-[13.5px] font-semibold text-gray-900" numberOfLines={expanded ? undefined : 1}>
                {r.issue_type}
              </Text>
              <Text className="mt-0.5 text-[11.5px] text-gray-500" numberOfLines={expanded ? undefined : 1}>
                {when(r)} · {money(r.quoted_price)}
              </Text>
            </Pressable>
            <View className={cell} style={{ width: 220 }}>
              <Text className="text-[13px] text-gray-900" numberOfLines={expanded ? undefined : 1}>
                {r.customer_name ?? 'Customer'}
              </Text>
              {!!r.customer_phone && (
                <Pressable onPress={() => Linking.openURL(`tel:${r.customer_phone}`)} className="flex-row items-center gap-1">
                  <Ionicons name="call-outline" size={11} color={BLUE} />
                  <Text className="text-[11.5px] font-medium" style={{ color: BLUE }}>
                    {r.customer_phone}
                  </Text>
                </Pressable>
              )}
            </View>
            <Text
              className={`${cell} text-[12.5px] text-gray-700`}
              style={{ width: 150 }}
              numberOfLines={expanded ? undefined : 1}
            >
              {r.technician_id ? technicianName(r.technician_id) : r.open_to_team ? 'Open to team' : 'Nobody yet'}
            </Text>
            <View className={cell} style={{ width: 170, gap: 4 }}>
              <Chip {...statusChip(r)} />
              {isOverdue(r) && <OverdueChip />}
            </View>
            <View className={cell} style={{ width: 100 }}>
              <Chip {...pay} />
            </View>
            <View className="flex-row px-3 py-2" style={{ width: 210, gap: 8 }}>
              {isOpenJob(r) ? (
                <>
                  <Pressable
                    onPress={() => onAssign(r)}
                    className="h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg"
                    style={{ backgroundColor: BLUE }}
                  >
                    <Ionicons name="person-add-outline" size={15} color="#FFFFFF" />
                    <Text className="text-[12.5px] font-semibold text-white">{r.technician_id ? 'Reassign' : 'Assign'}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onRequest(r)}
                    className="h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border bg-white"
                    style={{ borderColor: '#DDD6FE' }}
                  >
                    <Ionicons name="paper-plane-outline" size={15} color="#6D28D9" />
                    <Text className="text-[12.5px] font-semibold" style={{ color: '#6D28D9' }}>
                      Request
                    </Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  onPress={() => router.push(`/(reseller)/request/${r.id}` as any)}
                  className="h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white"
                >
                  <Ionicons name="eye-outline" size={15} color="#374151" />
                  <Text className="text-[12.5px] font-semibold text-gray-700">View</Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Who is doing what, and what nobody has picked up yet. Assigning still
 * happens on the job's own page (it needs the technician list and the
 * price); this board is the overview that page can't give - and the one
 * place to hand a job to the whole team at once. */
export default function WorkHub() {
  const userId = useAuthStore((state) => state.session?.user.id);
  const businessName = useAuthStore((state) => state.profile?.business_name);
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= WEB_SIDEBAR_MIN_WIDTH;
  const queryClient = useQueryClient();
  const updateRequest = useSupabaseUpdate('service_requests');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);
  const [assigning, setAssigning] = useState<{ request: ServiceRequest; mode: 'staff' | 'freelance' } | null>(null);
  const [sending, setSending] = useState(false);
  const [maximised, setMaximised] = useState(false);
  const [filter, setFilter] = useState<Filter>('active');
  // The sheet answers "what is on today"; the board answers "who is
  // carrying it". Opening on the lighter of the two.
  const [view, setView] = useState<'sheet' | 'board'>('sheet');

  const { data: mine, isLoading } = useSupabaseQuery('service_requests', {
    filters: userId ? { reseller_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!userId,
  });
  // The same unclaimed pool the Requests tab shows at its first stage -
  // nobody owns these yet, so they carry no reseller_id.
  const { data: incomingRaw } = useSupabaseQuery('service_requests', {
    filters: { status: 'pending', origin: 'app' },
    orderBy: { column: 'created_at', ascending: true },
  });
  const requests = useMemo(() => {
    const unclaimed = (incomingRaw ?? []).filter((r) => !r.reseller_id);
    return [...(mine ?? []), ...unclaimed];
  }, [mine, incomingRaw]);
  const { data: employees } = useMyEmployees(userId);
  // Freelancers are ranked by the same rules the job page uses - nearest
  // and free first, and never someone else's employee while on duty.
  const { rankedTechnicians, isLoading: loadingTechnicians } = useRankedTechnicians(
    assigning?.request.location_data,
    userId
  );

  // Work still to do is what the page opens on; the other filters are
  // there for when the question is "where did that job get to?".
  const shown = useMemo(() => {
    const picked = requests.filter((r) => matchesFilter(r, filter));
    return [...picked].sort((a, b) => {
      if (filter === 'active' || filter === 'all') {
        const overdue = Number(isOverdue(b) && LIVE_STATUSES.includes(b.status)) - Number(isOverdue(a) && LIVE_STATUSES.includes(a.status));
        if (overdue !== 0) return overdue;
        const unassigned = Number(!b.technician_id) - Number(!a.technician_id);
        if (unassigned !== 0) return unassigned;
      }
      return dueAt(a) - dueAt(b);
    });
  }, [requests, filter]);

  // The board is always about who is carrying work right now, whichever
  // filter the list is on.
  const live = useMemo(() => requests.filter((r) => LIVE_STATUSES.includes(r.status)), [requests]);
  const overdueCount = useMemo(() => live.filter(isOverdue).length, [live]);
  const countFor = (key: Filter) => requests.filter((r) => matchesFilter(r, key)).length;

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

  const technicianName = (id: string) =>
    employees.find((e) => e.profile.id === id)?.profile.full_name ??
    profileById.get(id)?.full_name ??
    'Technician';

  // The page shows open work only; the saved record is the whole month,
  // finished jobs included - that is the point of keeping it.
  const monthRows = useMemo((): WorkRecordRow[] => {
    const since = Date.now() - 30 * DAY_MS;
    return (requests ?? [])
      .filter((r) => new Date(r.created_at).getTime() >= since || dueAt(r) >= since)
      .sort((a, b) => dueAt(a) - dueAt(b))
      .map((r) => ({
        Date: r.scheduled_date ?? new Date(r.created_at).toISOString().slice(0, 10),
        Time: r.scheduled_time?.slice(0, 5) ?? '',
        Job: r.issue_type,
        Customer: r.customer_name ?? '',
        Phone: r.customer_phone ?? '',
        Address: r.location_data?.address ?? '',
        'Assigned to': r.technician_id ? technicianName(r.technician_id) : r.open_to_team ? 'Open to team' : 'Nobody yet',
        Status: STATUS_WORDS[r.status] ?? r.status,
        Payment: r.payment_status === 'paid' ? 'Paid' : 'Unpaid',
        Amount: r.quoted_price == null ? '' : Number(r.quoted_price),
      }));
  }, [requests, employees, allProfiles]);

  const periodLabel = `${new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10)} to ${new Date().toISOString().slice(0, 10)}`;
  const fileStem = `work-record-${new Date().toISOString().slice(0, 10)}`;

  async function saveRecord(kind: 'pdf' | 'xlsx') {
    if (monthRows.length === 0) {
      showAlert('Nothing to save', 'There is no work in the last 30 days yet.');
      return;
    }
    setExporting(kind);
    try {
      const title = `${businessName || 'Work record'} — last 30 days`;
      if (kind === 'pdf') {
        await exportWorkPdf(title, `${periodLabel} · ${monthRows.length} jobs`, monthRows);
      } else {
        await exportWorkXlsx(`${fileStem}.xlsx`, 'Work record', monthRows);
      }
    } catch (err) {
      showAlert('Could not save the record', getErrorMessage(err));
    } finally {
      setExporting(null);
    }
  }

  const staffChoices: PickPerson[] = useMemo(
    () =>
      employees.map(({ employment, profile }) => ({
        id: profile.id,
        name: profile.full_name,
        photoUrl: profile.avatar_url,
        line: [employment.job_title, `On duty ${employment.work_start_time?.slice(0, 5) ?? '09:00'}–${employment.work_end_time?.slice(0, 5) ?? '17:00'}`]
          .filter(Boolean)
          .join(' · '),
      })),
    [employees]
  );

  const freelanceChoices: PickPerson[] = useMemo(
    () =>
      rankedTechnicians
        .filter((t) => !t.isYourEmployee)
        .map((t) => ({
          id: t.id,
          name: t.full_name,
          photoUrl: t.avatar_url,
          line: [
            t.distance != null ? `${t.distance.toFixed(1)} km away` : t.city ?? 'Location unknown',
            t.is_available ? 'Free now' : 'Busy',
          ]
            .filter(Boolean)
            .join(' · '),
        })),
    [rankedTechnicians]
  );

  async function sendJobTo(person: PickPerson) {
    if (!assigning) return;
    setSending(true);
    try {
      await assignTechnician({ requestId: assigning.request.id, technicianId: person.id });
      await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
      setAssigning(null);
      showJobSentAlert(person.name);
    } catch (err) {
      showAlert('Could not send the job', getErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

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
                    {smallButton('Assign', 'person-add-outline', () => setAssigning({ request: r, mode: 'staff' }), 'blue')}
                    {smallButton(busyId === r.id ? 'Opening…' : 'Open to team', 'megaphone-outline', () => setOpenToTeam(r, true), 'ghost')}
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
                    {smallButton('Assign instead', 'person-add-outline', () => setAssigning({ request: r, mode: 'staff' }), 'ghost')}
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
          {overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}
        </Text>
      </View>
      {view === 'sheet' && (
        <Pressable
          onPress={() => setMaximised(true)}
          className="h-9 flex-row items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3"
          accessibilityLabel="Full screen"
        >
          <Ionicons name="expand-outline" size={15} color="#374151" />
          <Text className="text-[12.5px] font-semibold text-gray-700">Full screen</Text>
        </Pressable>
      )}

      <Pressable
        onPress={() => router.push('/(reseller)/new-request?from=workhub' as any)}
        className="h-9 flex-row items-center gap-1.5 rounded-lg px-3"
        style={{ backgroundColor: BLUE }}
      >
        <Ionicons name="add" size={16} color="#FFFFFF" />
        <Text className="text-[12.5px] font-semibold text-white">Add work</Text>
      </Pressable>

      {view === 'sheet' && (
        <>
          <Pressable
            onPress={() => saveRecord('pdf')}
            disabled={!!exporting}
            className="h-9 flex-row items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 disabled:opacity-50"
          >
            <Ionicons name="document-text-outline" size={15} color="#B91C1C" />
            <Text className="text-[12.5px] font-semibold text-gray-700">
              {exporting === 'pdf' ? 'Saving…' : 'PDF'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => saveRecord('xlsx')}
            disabled={!!exporting}
            className="h-9 flex-row items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 disabled:opacity-50"
          >
            <Ionicons name="grid-outline" size={15} color="#047857" />
            <Text className="text-[12.5px] font-semibold text-gray-700">
              {exporting === 'xlsx' ? 'Saving…' : 'Excel'}
            </Text>
          </Pressable>
        </>
      )}

      {view === 'board' && (
        <Pressable
          onPress={() => setView('sheet')}
          className="h-9 flex-row items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3"
        >
          <Ionicons name="list-outline" size={15} color="#374151" />
          <Text className="text-[12.5px] font-semibold text-gray-700">Back to list</Text>
        </Pressable>
      )}
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

  const filterChips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {FILTERS.map((f) => {
        const active = filter === f.key;
        return (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            className="h-9 flex-row items-center gap-1.5 rounded-full px-3.5"
            style={{
              backgroundColor: active ? f.color : '#FFFFFF',
              borderWidth: active ? 0 : 1,
              borderColor: '#E5E7EB',
            }}
          >
            <Text className={`text-[12.5px] font-semibold ${active ? 'text-white' : 'text-gray-700'}`}>{f.label}</Text>
            <View
              className="h-5 min-w-5 items-center justify-center rounded-full px-1.5"
              style={{ backgroundColor: active ? 'rgba(255,255,255,0.25)' : '#F3F4F6' }}
            >
              <Text className={`text-[11px] font-extrabold ${active ? 'text-white' : 'text-gray-600'}`}>
                {countFor(f.key)}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const sheet = (
    <>
      {filterChips}
      <JobSheet
        jobs={shown}
        technicianName={technicianName}
        onAssign={(r) => setAssigning({ request: r, mode: 'staff' })}
        onRequest={(r) => setAssigning({ request: r, mode: 'freelance' })}
        busyId={busyId}
        wide={wide}
      />
      <Text className="px-1 text-[11.5px] leading-[17px] text-gray-400">
        Every job from Requests is here - switch the row above to see completed, paid or cancelled ones. PDF and Excel
        save the last 30 days in full ({monthRows.length} job{monthRows.length === 1 ? '' : 's'}).
      </Text>

      {/* Full screen: the same list with nothing clipped, for long job
          names that the column can only show the start of. */}
      <Modal visible={maximised} animationType="slide" onRequestClose={() => setMaximised(false)}>
        <View className="flex-1 bg-gray-50">
          <View className="flex-row items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
            <View className="flex-1">
              <Text className="text-[16px] font-bold text-gray-900">
                {shown.length} job{shown.length === 1 ? '' : 's'}
              </Text>
              <Text className="mt-0.5 text-[11.5px] text-gray-500">Full names, nothing cut short</Text>
            </View>
            <Pressable
              onPress={() => setMaximised(false)}
              className="h-9 flex-row items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3"
            >
              <Ionicons name="contract-outline" size={15} color="#374151" />
              <Text className="text-[12.5px] font-semibold text-gray-700">Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: wide ? 24 : 12, paddingBottom: 40, gap: 12 }}>
            {filterChips}
            <JobSheet
              jobs={shown}
              technicianName={technicianName}
              onAssign={(r) => setAssigning({ request: r, mode: 'staff' })}
              onRequest={(r) => setAssigning({ request: r, mode: 'freelance' })}
              busyId={busyId}
              wide={wide}
              expanded
            />
          </ScrollView>
        </View>
      </Modal>

      <AssignSheet
        request={assigning?.request ?? null}
        mode={assigning?.mode ?? 'staff'}
        people={assigning?.mode === 'freelance' ? freelanceChoices : staffChoices}
        loading={assigning?.mode === 'freelance' && loadingTechnicians}
        onPick={sendJobTo}
        onClose={() => setAssigning(null)}
        busy={sending}
      />

      <Pressable
        onPress={() => setView('board')}
        className="flex-row items-center justify-center gap-2 rounded-2xl border border-gray-300 bg-white py-3.5"
      >
        <Ionicons name="grid-outline" size={17} color={BLUE} />
        <Text className="text-[14px] font-semibold" style={{ color: BLUE }}>
          View details
        </Text>
        <Text className="text-[12px] text-gray-500">— who is carrying what</Text>
      </Pressable>
    </>
  );

  if (wide) {
    return (
      <ScrollView className="flex-1 bg-gray-50" contentContainerStyle={{ padding: 32, paddingTop: 20, gap: 16 }}>
        {header}
        {view === 'sheet' ? (
          sheet
        ) : (
          // flexGrow/minWidth let the columns (each 320px at least) share any
          // extra room instead of leaving an empty strip on the right.
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            contentContainerStyle={{ gap: 14, paddingBottom: 8, flexGrow: 1, minWidth: '100%' }}
          >
            {columns}
          </ScrollView>
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 14 }}>
      {header}
      {view === 'sheet' ? sheet : columns}
    </ScrollView>
  );
}
