// app/(technician)/employment.tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../lib/hooks/useAuth';
import {
  useMyEmployment,
  useApplyToReseller,
  useEndEmployment,
  useFindResellerByPhone,
  useMyInvites,
  useRespondToHire,
  useRequestToLeave,
} from '../../lib/hooks/useTechnicianEmployment';
import { TimeField } from '../../lib/components/DateTimeFields';
import { showAlert, getErrorMessage } from '../../lib/utils/alert';
import { isValidPhone10 } from '../../lib/utils/phone';
import { workHoursIssue } from '../../lib/utils/workHours';

function ApplyForm({ technicianId }: { technicianId: string }) {
  const [phone, setPhone] = useState('');
  const [workStart, setWorkStart] = useState('09:00');
  const [workEnd, setWorkEnd] = useState('17:00');
  const [searching, setSearching] = useState(false);
  const findReseller = useFindResellerByPhone();
  const applyToReseller = useApplyToReseller();

  async function handleApply() {
    const trimmed = phone.trim();
    const hoursIssue = workHoursIssue(workStart, workEnd);
    if (hoursIssue) {
      showAlert('Check the work hours', hoursIssue);
      return;
    }
    if (!isValidPhone10(trimmed)) {
      showAlert('Check the phone number', "Enter the reseller's 10-digit phone number.");
      return;
    }
    setSearching(true);
    try {
      const reseller = await findReseller(trimmed);
      if (!reseller) {
        showAlert('Not found', 'No reseller is registered with that phone number.');
        return;
      }
      await applyToReseller.apply({
        technicianId,
        resellerId: reseller.id,
        workStartTime: workStart,
        workEndTime: workEnd,
      });
      showAlert('Request sent', `${reseller.full_name ?? 'The reseller'} will review your request.`);
    } catch (err) {
      showAlert('Could not send request', getErrorMessage(err));
    } finally {
      setSearching(false);
    }
  }

  return (
    <View className="rounded-2xl border border-gray-200 bg-white p-4">
      <Text className="mb-1 text-base font-semibold text-gray-900">Work for a reseller</Text>
      <Text className="mb-4 text-xs text-gray-500">
        Send a request to become a reseller's employee technician. Once accepted, they can send you jobs
        straight from their team page (you still accept each one), and you won't be offered outsource work from
        other resellers during your declared work hours.
      </Text>

      <Text className="mb-1 text-xs font-medium text-gray-600">Reseller's phone number</Text>
      <TextInput
        value={phone}
        onChangeText={(v) => setPhone(v.replace(/[^0-9]/g, ''))}
        placeholder="98XXXXXXXX"
        keyboardType="phone-pad"
        maxLength={10}
        className="mb-3 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
      />

      <Text className="mb-1 text-xs font-medium text-gray-600">Your work hours</Text>
      <View className="mb-4 flex-row items-center gap-2">
        <View className="flex-1">
          <TimeField value={workStart} onChange={setWorkStart} />
        </View>
        <Text className="text-xs text-gray-400">to</Text>
        <View className="flex-1">
          <TimeField value={workEnd} onChange={setWorkEnd} />
        </View>
      </View>

      <Pressable
        onPress={handleApply}
        disabled={searching}
        className="items-center rounded-xl bg-orange-500 py-3 disabled:opacity-50"
      >
        <Text className="text-sm font-bold text-white">{searching ? 'Sending…' : 'Send request'}</Text>
      </Pressable>
    </View>
  );
}

/** Resellers who invited this technician - accepting one makes it their
 * employer, declining just closes that invite. */
function InvitesList({ technicianId, employed }: { technicianId: string; employed: boolean }) {
  const { data: invites } = useMyInvites(technicianId);
  const respond = useRespondToHire();

  async function handleRespond(id: string, accept: boolean) {
    try {
      await respond.respond(id, accept);
    } catch (err) {
      const message = getErrorMessage(err);
      showAlert(
        'Could not update',
        message.includes('one_active') ? 'Leave your current employer before accepting another invite.' : message
      );
    }
  }

  if (invites.length === 0) return null;

  return (
    <View className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
      <View className="mb-3 flex-row items-center gap-2">
        <Ionicons name="mail-unread-outline" size={18} color="#2563EB" />
        <Text className="text-base font-semibold text-gray-900">
          {invites.length === 1 ? 'A reseller invited you' : `${invites.length} resellers invited you`}
        </Text>
      </View>
      {employed && (
        <Text className="mb-3 text-xs text-gray-500">You already work for a reseller - leave them first to accept.</Text>
      )}
      {invites.map(({ employment, reseller }) => (
        <View key={employment.id} className="mb-2 rounded-xl border border-blue-100 bg-white p-3.5">
          <Text className="font-semibold text-gray-900">
            {reseller?.business_name || reseller?.full_name || 'A reseller'}
          </Text>
          <Text className="mt-0.5 text-xs text-gray-500">
            {reseller?.business_name && reseller?.full_name ? `${reseller.full_name} · ` : ''}
            Work hours {employment.work_start_time?.slice(0, 5) ?? '09:00'} to {employment.work_end_time?.slice(0, 5) ?? '17:00'}
          </Text>
          <View className="mt-3 flex-row gap-2">
            <Pressable
              onPress={() => handleRespond(employment.id, false)}
              disabled={respond.isPending}
              className="flex-1 items-center rounded-lg border border-gray-300 bg-white py-2.5 disabled:opacity-50"
            >
              <Text className="text-sm font-semibold text-gray-600">Decline</Text>
            </Pressable>
            <Pressable
              onPress={() => handleRespond(employment.id, true)}
              disabled={respond.isPending || employed}
              className="flex-1 items-center rounded-lg py-2.5 disabled:opacity-50"
              style={{ backgroundColor: '#2563EB' }}
            >
              <Text className="text-sm font-semibold text-white">Accept</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function EmploymentScreen() {
  const userId = useAuthStore((state) => state.session?.user.id);
  const { current, employer } = useMyEmployment(userId);
  const endEmployment = useEndEmployment();
  const leave = useRequestToLeave();
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveReason, setLeaveReason] = useState('');

  // Only for cancelling a request that is still pending. Once accepted,
  // leaving needs the employer's approval (handleRequestLeave) - the
  // database refuses a direct end.
  async function handleCancelRequest() {
    if (!current) return;
    try {
      await endEmployment.end(current.id);
    } catch (err) {
      showAlert('Could not update', getErrorMessage(err));
    }
  }

  async function handleRequestLeave() {
    if (!current) return;
    try {
      await leave.request(current.id, leaveReason);
      setLeaveOpen(false);
      setLeaveReason('');
    } catch (err) {
      showAlert('Could not send request', getErrorMessage(err));
    }
  }

  async function handleWithdrawLeave() {
    if (!current) return;
    try {
      await leave.withdraw(current.id);
    } catch (err) {
      showAlert('Could not update', getErrorMessage(err));
    }
  }

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
      {userId && <InvitesList technicianId={userId} employed={current?.status === 'accepted'} />}

      {!current && userId && <ApplyForm technicianId={userId} />}

      {current?.status === 'pending' && (
        <View className="items-center rounded-2xl border border-dashed border-blue-200 bg-blue-50 p-6">
          <Ionicons name="time-outline" size={28} color="#3b82f6" />
          <Text className="mt-2 text-center font-semibold text-gray-900">
            Waiting on {employer?.full_name ?? 'the reseller'}
          </Text>
          <Text className="mt-1 text-center text-xs text-gray-500">
            You'll be notified once they respond to your request.
          </Text>
          <Pressable onPress={handleCancelRequest} disabled={endEmployment.isPending} className="mt-4 px-3 py-1.5">
            <Text className="text-sm font-semibold text-gray-500">Cancel request</Text>
          </Pressable>
        </View>
      )}

      {current?.status === 'accepted' && (
        <View className="rounded-2xl border border-gray-200 bg-white p-5">
          <View className="mb-4 flex-row items-center gap-2">
            <Ionicons name="checkmark-circle" size={20} color="#059669" />
            <Text className="text-base font-semibold text-gray-900">
              You work for {employer?.full_name ?? 'this reseller'}
            </Text>
          </View>

          <Text className="mb-1 text-xs font-medium text-gray-600">Your work hours</Text>
          <View className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
            <Text className="text-sm text-gray-900">
              {(current.work_start_time?.slice(0, 5) ?? '09:00')} to {(current.work_end_time?.slice(0, 5) ?? '17:00')}
            </Text>
          </View>
          <Text className="mb-4 text-[11px] text-gray-400">
            Outside these hours you're free to take outsource work from other resellers too. Contact your employer
            to change your work hours.
          </Text>
          <View className="mb-4 flex-row items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5">
            <Ionicons name="location-outline" size={15} color="#2563EB" />
            <Text className="flex-1 text-[11.5px] leading-[16px] text-blue-900">
              During your work hours, while the app is open, your employer can see where you are and the jobs
              they've sent you. Nothing is shared outside your shift or with other resellers.
            </Text>
          </View>

          {current.leave_requested_at ? (
            <View className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
              <View className="mb-1 flex-row items-center gap-2">
                <Ionicons name="time-outline" size={16} color="#D97706" />
                <Text className="flex-1 text-sm font-semibold text-gray-900">
                  Waiting for {employer?.full_name ?? 'your employer'} to approve
                </Text>
              </View>
              <Text className="text-xs text-gray-600">
                You stay on their team until they approve your request to leave. You'll be told as soon as they answer.
              </Text>
              <Pressable onPress={handleWithdrawLeave} disabled={leave.isPending} className="mt-3 self-start py-1">
                <Text className="text-sm font-semibold text-gray-500">Withdraw request</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {!!current.leave_rejected_at && (
                <View className="mb-3 flex-row items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
                  <Ionicons name="close-circle" size={15} color="#DC2626" />
                  <Text className="flex-1 text-[12px] leading-[16px] text-red-800">
                    {employer?.full_name ?? 'Your employer'} declined your request to leave. You can ask again.
                  </Text>
                </View>
              )}
              <Pressable
                onPress={() => setLeaveOpen(true)}
                className="items-center rounded-xl border border-red-200 bg-red-50 py-2.5"
              >
                <Text className="text-sm font-semibold text-red-600">Request to leave</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      <Modal visible={leaveOpen} transparent animationType="fade" onRequestClose={() => setLeaveOpen(false)}>
        <Pressable className="flex-1 items-center justify-center bg-black/40 px-6" onPress={() => setLeaveOpen(false)}>
          <Pressable onPress={() => {}} className="w-full max-w-sm rounded-xl bg-white p-4">
            <Text className="mb-1 text-base font-bold text-gray-900">Request to leave</Text>
            <Text className="mb-3 text-xs text-gray-500">
              This goes to {employer?.full_name ?? 'your employer'}. You stay on their team until they approve it, and
              they can also reject it.
            </Text>
            <TextInput
              value={leaveReason}
              onChangeText={setLeaveReason}
              placeholder="Reason (optional)"
              multiline
              numberOfLines={3}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900"
              style={{ minHeight: 72, textAlignVertical: 'top' }}
            />
            <View className="mt-4 flex-row gap-2">
              <Pressable
                onPress={() => setLeaveOpen(false)}
                disabled={leave.isPending}
                className="flex-1 items-center rounded-lg border border-gray-300 py-2.5 disabled:opacity-50"
              >
                <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleRequestLeave}
                disabled={leave.isPending}
                className="flex-1 items-center rounded-lg bg-red-600 py-2.5 disabled:opacity-50"
              >
                <Text className="text-sm font-semibold text-white">{leave.isPending ? 'Sending…' : 'Send request'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
