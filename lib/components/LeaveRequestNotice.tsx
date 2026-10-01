// lib/components/LeaveRequestNotice.tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useDecideLeaveRequest, useLeaveRequests, useMyEmployment } from '../hooks/useTechnicianEmployment';
import { subscribeToTable } from '../hooks/useSupabase';
import { showAlert, getErrorMessage } from '../utils/alert';

function initialsOf(name: string | null | undefined) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/** Employer side: pops up over whatever screen is open the moment one of
 * their technicians asks to leave. Approve ends the employment; Reject keeps
 * them on and tells the technician no. "Later" just hides it for now - the
 * request stays on the dashboard until it is answered, and a technician
 * cannot leave until then. */
export function ResellerLeaveRequestNotice({ resellerId }: { resellerId: string | undefined }) {
  const requests = useLeaveRequests(resellerId);
  const decide = useDecideLeaveRequest();
  // Keyed by id + request time so a technician who asks again after being
  // turned down pops up again even if the earlier one was dismissed.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const keyOf = (r: (typeof requests)[number]) => `${r.employment.id}:${r.employment.leave_requested_at}`;
  const current = requests.find((r) => !dismissed.has(keyOf(r)));
  if (!current) return null;

  const { employment, profile } = current;
  const name = profile.full_name ?? 'A technician';
  const others = requests.length - 1;

  async function answer(approve: boolean) {
    try {
      await decide.decide(employment.id, approve);
    } catch (err) {
      showAlert('Could not update', getErrorMessage(err));
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setDismissed((d) => new Set(d).add(keyOf(current)))}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full max-w-sm rounded-2xl bg-white p-5">
          <View className="mb-3 flex-row items-center gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-amber-500">
              <Text className="text-sm font-bold text-white">{initialsOf(profile.full_name)}</Text>
            </View>
            <View className="flex-1">
              <Text className="text-base font-bold text-gray-900">{name}</Text>
              <Text className="text-xs text-gray-500">wants to leave your team</Text>
            </View>
            <Ionicons name="exit-outline" size={22} color="#D97706" />
          </View>

          {!!employment.leave_reason && (
            <View className="mb-3 rounded-lg bg-gray-50 px-3 py-2.5">
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Reason</Text>
              <Text className="mt-0.5 text-sm text-gray-800">{employment.leave_reason}</Text>
            </View>
          )}
          <Text className="mb-4 text-xs text-gray-500">
            {name} stays on your team until you approve. If you reject, they are told and remain your employee.
          </Text>

          <View className="flex-row gap-2">
            <Pressable
              onPress={() => answer(false)}
              disabled={decide.isPending}
              className="flex-1 items-center rounded-lg border border-gray-300 py-2.5 disabled:opacity-50"
            >
              <Text className="text-sm font-semibold text-gray-700">Reject</Text>
            </Pressable>
            <Pressable
              onPress={() => answer(true)}
              disabled={decide.isPending}
              className="flex-1 items-center rounded-lg bg-red-600 py-2.5 disabled:opacity-50"
            >
              <Text className="text-sm font-semibold text-white">Approve</Text>
            </Pressable>
          </View>
          <Pressable
            onPress={() => setDismissed((d) => new Set(d).add(keyOf(current)))}
            className="mt-3 items-center py-1.5"
          >
            <Text className="text-xs font-semibold text-gray-500">
              Decide later{others > 0 ? ` · ${others} more waiting` : ''}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Technician side: tells them straight away - while the app is open - how
 * their employer answered a request to leave. The first load only records
 * where things stand, so an old answer doesn't pop up again on every launch
 * (the Employment screen keeps the "declined" note for that). */
export function TechnicianLeaveNotice({ technicianId }: { technicianId: string | undefined }) {
  const queryClient = useQueryClient();
  const { current } = useMyEmployment(technicianId);
  const seen = useRef<{ hadRequest: boolean; employed: boolean } | null>(null);

  useEffect(() => {
    if (!technicianId) return;
    const unsubscribe = subscribeToTable(
      'technician_employment',
      () => queryClient.invalidateQueries({ queryKey: ['technician_employment'] }),
      `technician_id=eq.${technicianId}`,
      'leave-answer'
    );
    const poll = setInterval(() => queryClient.invalidateQueries({ queryKey: ['technician_employment'] }), 20_000);
    return () => {
      unsubscribe();
      clearInterval(poll);
    };
  }, [technicianId, queryClient]);

  useEffect(() => {
    const employed = current?.status === 'accepted';
    const hadRequest = employed && !!current?.leave_requested_at;
    const prev = seen.current;
    seen.current = { hadRequest, employed };
    if (!prev?.hadRequest) return;

    if (!employed) {
      showAlert('Leave approved', 'Your employer approved your request. You are no longer on their team.');
    } else if (!hadRequest && current?.leave_rejected_at) {
      showAlert('Request declined', 'Your employer declined your request to leave. You remain on their team.', [
        { text: 'OK', style: 'cancel' },
        { text: 'View', onPress: () => router.push('/(technician)/employment' as never) },
      ]);
    }
  }, [current]);

  return null;
}
