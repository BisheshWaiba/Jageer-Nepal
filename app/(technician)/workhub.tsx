// app/(technician)/workhub.tsx
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Linking, Platform, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { useSupabaseQuery } from '../../lib/hooks/useSupabase';
import {
  useMyEmployment,
  useMyStaffRole,
  useTeamRoster,
  supervisorAssignJob,
  supervisorSetOpenToTeam,
  type TeamMate,
} from '../../lib/hooks/useTechnicianEmployment';
import { PersonAvatar } from '../../lib/components/PersonAvatar';
import { CategoryBadge } from '../../lib/components/CategoryBadge';
import { showAlert, getErrorMessage } from '../../lib/utils/alert';
import { PaymentStatusSheet, PaymentChip } from '../../lib/components/PaymentStatusSheet';
import { WEB_SIDEBAR_MIN_WIDTH } from '../../lib/components/web/WebSidebarShell';
import type { ServiceRequest } from '../../types/database.types';

const BLUE = '#2563EB';
// A supervisor also handles the money side, so jobs finished but not yet
// settled stay on their list (set_job_payment lets them record it).
const LIVE: ServiceRequest['status'][] = ['pending', 'approved', 'assigned', 'in_progress'];
const isUnsettled = (r: ServiceRequest) => r.status === 'resolved' && r.payment_status !== 'paid';

function money(n: number | null | undefined): string {
  return n == null ? '—' : `NPR ${Math.round(Number(n)).toLocaleString()}`;
}

function statusChip(request: ServiceRequest): { label: string; color: string; bg: string } {
  if (request.status === 'in_progress') return { label: 'Working on it', color: '#1D4ED8', bg: '#EFF6FF' };
  if (request.status === 'assigned') return { label: 'Waiting to accept', color: '#B45309', bg: '#FFFBEB' };
  if (request.open_to_team) return { label: 'Open to the team', color: '#047857', bg: '#ECFDF5' };
  return { label: 'Nobody yet', color: '#6B7280', bg: '#F3F4F6' };
}

/** Pick who does a job. Only teammates - the list itself comes from the
 * server (my_team_roster), which only answers supervisors. */
function PickTeammate({
  visible,
  roster,
  onPick,
  onClose,
}: {
  visible: boolean;
  roster: TeamMate[];
  onPick: (mate: TeamMate) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/50 px-4" onPress={onClose}>
        <Pressable onPress={() => {}} className="w-full overflow-hidden rounded-2xl bg-white" style={{ maxWidth: 400, maxHeight: '85%' }}>
          <View className="flex-row items-center gap-2.5 px-5 py-4" style={{ backgroundColor: BLUE }}>
            <Text className="flex-1 text-[16px] font-bold text-white">Who should do this?</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
          <ScrollView>
            {roster.length === 0 ? (
              <Text className="px-5 py-5 text-sm text-gray-500">Nobody else is on the team yet.</Text>
            ) : (
              roster.map((mate, i) => (
                <Pressable
                  key={mate.technician_id}
                  onPress={() => onPick(mate)}
                  className={`flex-row items-center gap-3 px-5 py-3.5 ${i === roster.length - 1 ? '' : 'border-b border-gray-100'}`}
                >
                  <PersonAvatar name={mate.full_name} photoUrl={mate.avatar_url} size={36} bg="bg-blue-600" />
                  <View className="flex-1">
                    <Text className="text-[14px] font-semibold text-gray-900" numberOfLines={1}>
                      {mate.full_name ?? 'Technician'}
                      {mate.staff_role === 'supervisor' ? ' · supervisor' : ''}
                    </Text>
                    <Text className="text-[11.5px] text-gray-500" numberOfLines={1}>
                      {[mate.job_title, `On duty ${mate.work_start_time?.slice(0, 5) ?? '09:00'}–${mate.work_end_time?.slice(0, 5) ?? '17:00'}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
                </Pressable>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** A supervisor's version of the reseller's Work Hub: the same jobs, the
 * same two moves (give it to someone, or open it to everyone), without
 * being able to touch the price, the customer or anything else - the
 * server only exposes those two actions (migration 0077). */
export default function TechnicianWorkHub() {
  const userId = useAuthStore((state) => state.session?.user.id);
  const staffRole = useMyStaffRole(userId);
  const { employer } = useMyEmployment(userId);
  const isSupervisor = staffRole === 'supervisor';
  const roster = useTeamRoster(isSupervisor);
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= WEB_SIDEBAR_MIN_WIDTH;

  const [picking, setPicking] = useState<ServiceRequest | null>(null);
  const [payingFor, setPayingFor] = useState<ServiceRequest | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // RLS hands a supervisor their employer's jobs and nobody else's, so no
  // filter is needed beyond "still in play".
  const { data: requests, isLoading } = useSupabaseQuery('service_requests', {
    orderBy: { column: 'created_at', ascending: false },
    enabled: isSupervisor,
    queryOptions: { refetchInterval: 30_000 },
  });
  const jobs = useMemo(
    () => (requests ?? []).filter((r) => LIVE.includes(r.status) || isUnsettled(r)),
    [requests]
  );
  const nameOf = (id: string | null) =>
    id ? (roster.find((m) => m.technician_id === id)?.full_name ?? 'A technician') : null;

  async function assign(request: ServiceRequest, mate: TeamMate) {
    setBusyId(request.id);
    setPicking(null);
    try {
      await supervisorAssignJob(request.id, mate.technician_id);
      await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
      showAlert('Sent', `${mate.full_name ?? 'They'} will get it on their phone to accept.`);
    } catch (err) {
      showAlert('Could not assign', getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function openToTeam(request: ServiceRequest, open: boolean) {
    setBusyId(request.id);
    try {
      await supervisorSetOpenToTeam(request.id, open);
      await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
    } catch (err) {
      showAlert('Could not update', getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (!isSupervisor) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 px-8">
        <Ionicons name="lock-closed-outline" size={30} color="#D1D5DB" />
        <Text className="mt-3 text-center text-[15px] font-semibold text-gray-700">This is for supervisors</Text>
        <Text className="mt-1 text-center text-[12.5px] text-gray-500">
          Your employer can make you a supervisor, which lets you hand their work to the rest of the team.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      contentContainerStyle={{ padding: wide ? 32 : 16, paddingBottom: 48, gap: 12 }}
    >
      <View>
        <Text className="text-[15px] font-bold text-gray-900">
          {jobs.length} job{jobs.length === 1 ? '' : 's'} in play
        </Text>
        <Text className="mt-0.5 text-[12px] text-gray-500">
          {employer?.business_name || employer?.full_name || 'Your employer'} · you can hand these to the team
        </Text>
      </View>

      {isLoading && !requests ? (
        <Text className="text-sm text-gray-500">Loading…</Text>
      ) : jobs.length === 0 ? (
        <View className="items-center rounded-2xl border border-dashed border-gray-200 bg-white py-10">
          <Ionicons name="clipboard-outline" size={26} color="#D1D5DB" />
          <Text className="mt-2 text-sm text-gray-500">Nothing to hand out right now.</Text>
        </View>
      ) : (
        jobs.map((r) => {
          const chip = statusChip(r);
          const holder = nameOf(r.technician_id);
          return (
            <View key={r.id} className="rounded-2xl border border-gray-200 bg-white p-3.5">
              <Pressable onPress={() => router.push(`/(technician)/job/${r.id}` as any)} className="flex-row items-start gap-2.5">
                <CategoryBadge category={r.issue_type} size={32} />
                <View className="flex-1">
                  <Text className="text-[14px] font-bold text-gray-900" numberOfLines={1}>
                    {r.issue_type}
                  </Text>
                  <Text className="mt-0.5 text-[12px] text-gray-600" numberOfLines={1}>
                    {r.customer_name ?? 'Customer'}
                    {r.customer_phone ? ` · ${r.customer_phone}` : ''}
                  </Text>
                  <Text className="mt-0.5 text-[11.5px] text-gray-500" numberOfLines={1}>
                    {r.scheduled_date ?? 'No date'}
                    {r.scheduled_time ? ` · ${r.scheduled_time}` : ''} · {r.location_data?.address ?? 'No address'}
                  </Text>
                  <View className="mt-1.5 flex-row flex-wrap items-center" style={{ gap: 6 }}>
                    <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: chip.bg }}>
                      <Text className="text-[10.5px] font-bold" style={{ color: chip.color }}>
                        {chip.label}
                      </Text>
                    </View>
                    {!!holder && <Text className="text-[11.5px] text-gray-600">{holder}</Text>}
                    <PaymentChip request={r} total={Number(r.quoted_price ?? 0)} />
                    <Text className="text-[11.5px] font-semibold text-gray-700">{money(r.quoted_price)}</Text>
                  </View>
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
                {r.status === 'resolved' ? (
                  <Pressable
                    onPress={() => setPayingFor(r)}
                    className="h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg"
                    style={{ backgroundColor: '#047857' }}
                  >
                    <Ionicons name="cash-outline" size={15} color="#FFFFFF" />
                    <Text className="text-[12.5px] font-semibold text-white">Record payment</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => setPicking(r)}
                  disabled={busyId === r.id}
                  className="h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg disabled:opacity-60"
                  style={{ backgroundColor: BLUE }}
                >
                  <Ionicons name="person-add-outline" size={15} color="#FFFFFF" />
                  <Text className="text-[12.5px] font-semibold text-white">
                    {r.technician_id ? 'Give to someone else' : 'Give to someone'}
                  </Text>
                </Pressable>
                {!r.technician_id && (
                  <Pressable
                    onPress={() => openToTeam(r, !r.open_to_team)}
                    disabled={busyId === r.id}
                    className="h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white disabled:opacity-60"
                  >
                    <Ionicons name={r.open_to_team ? 'close-circle-outline' : 'megaphone-outline'} size={15} color="#374151" />
                    <Text className="text-[12.5px] font-semibold text-gray-700">
                      {busyId === r.id ? 'Saving…' : r.open_to_team ? 'Take back' : 'Open to team'}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })
      )}

      {payingFor && (
        <PaymentStatusSheet
          visible
          request={payingFor}
          total={Number(payingFor.quoted_price ?? 0)}
          onClose={() => setPayingFor(null)}
        />
      )}

      <PickTeammate
        visible={!!picking}
        roster={roster.filter((m) => m.technician_id !== picking?.technician_id)}
        onPick={(mate) => picking && assign(picking, mate)}
        onClose={() => setPicking(null)}
      />
    </ScrollView>
  );
}
