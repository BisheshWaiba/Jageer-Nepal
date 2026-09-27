// app/(technician)/job/[id].tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { respondToJobOffer, reopenCompletedJob } from '../../../lib/hooks/useJobOffers';
import { requestJobHold, resumeJobHold } from '../../../lib/hooks/useJobHold';
import { useAuthStore } from '../../../lib/hooks/useAuth';
import { useSupabaseRow, useSupabaseUpdate, useSupabaseInsert, useSupabaseQuery } from '../../../lib/hooks/useSupabase';
import { RequestDetailsExtras } from '../../../lib/components/RequestDetailsExtras';
import { PersonAvatar } from '../../../lib/components/PersonAvatar';
import { CategoryBadge } from '../../../lib/components/CategoryBadge';
import { ChalanPhotos } from '../../../lib/components/ChalanPhotos';
import { HoldRequestModal } from '../../../lib/components/HoldRequestModal';
import { showAlert, getErrorMessage } from '../../../lib/utils/alert';
import { formatDuration, formatTimestamp } from '../../../lib/utils/duration';
import { decimalInput, digitsInput } from '../../../lib/utils/number';
import type { RequestStatus } from '../../../types/database.types';

// Ticks once a minute - jobs run from minutes to days, so second-level
// precision would just cause unnecessary re-renders for no visible benefit.
function useNow(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

// An offered job ('assigned') is answered with Accept / Reject instead -
// see handleRespond below.
const NEXT_STATUS: Partial<Record<RequestStatus, RequestStatus>> = {
  in_progress: 'resolved',
};

const STATUS_ACTION_LABEL: Partial<Record<RequestStatus, string>> = {
  in_progress: 'Mark job complete',
};

// The four stages of a job as the technician lives them: they accept an
// offer, work on it, mark it complete, and it closes once the reseller has
// collected the money. Shown as a strip so it's always obvious which one
// the job is in - accepting a job starts the work, it does not finish it.
const STAGES = ['Accepted', 'Work in progress', 'Completed', 'Paid'] as const;

function currentStageIndex(status: RequestStatus, paid: boolean): number {
  if (paid) return 3;
  if (status === 'resolved') return 2;
  if (status === 'in_progress') return 1;
  return 0;
}

function StageStrip({ status, paid }: { status: RequestStatus; paid: boolean }) {
  const current = currentStageIndex(status, paid);
  return (
    <View className="mb-6 rounded-xl bg-white p-4">
      <Text className="mb-3 text-sm uppercase tracking-wide text-gray-400">Progress</Text>
      <View className="flex-row" style={{ gap: 6 }}>
        {STAGES.map((label, i) => {
          const done = i < current;
          const now = i === current;
          const color = done ? '#16A34A' : now ? '#2563EB' : '#D1D5DB';
          return (
            <View key={label} className="flex-1" style={{ gap: 6 }}>
              <View style={{ height: 4, borderRadius: 2, backgroundColor: color }} />
              <View className="flex-row items-center" style={{ gap: 3 }}>
                {done && <Ionicons name="checkmark-circle" size={12} color={color} />}
                <Text
                  className={`text-[11px] ${now ? 'font-bold' : 'font-medium'}`}
                  style={{ color: done ? '#15803D' : now ? '#1D4ED8' : '#9CA3AF' }}
                  numberOfLines={2}
                >
                  {label}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

interface PartRow {
  name: string;
  quantity: string;
  cost: string;
}

export default function JobCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Hidden tab screens stay mounted between visits, so opening another
  // record reused this one's component state (typed quote/remark/price, a
  // "thanks for rating" flag, an open edit form...). Keying on the id gives
  // every record its own fresh state.
  return <JobCard key={id} id={id} />;
}

function JobCard({ id }: { id: string }) {
  const userId = useAuthStore((state) => state.session?.user.id);
  const { data: request, isLoading, isError } = useSupabaseRow('service_requests', id);
  const { data: jobCards } = useSupabaseQuery('job_cards', {
    filters: id ? { service_request_id: id } : {},
    enabled: !!id,
  });
  const jobCard = jobCards?.[0] ?? null;
  const hasAccepted = !!request && request.status !== 'assigned';
  const { data: customer } = useSupabaseRow('profiles', hasAccepted ? request?.client_id : undefined);
  const { data: reseller } = useSupabaseRow('profiles', hasAccepted ? request?.reseller_id ?? undefined : undefined);

  const updateRequest = useSupabaseUpdate('service_requests');
  const insertJobCard = useSupabaseInsert('job_cards');
  const updateJobCard = useSupabaseUpdate('job_cards');

  // Empty (with a "0" placeholder) rather than a pre-filled "0", which
  // turned typing 500 into "0500".
  const [parts, setParts] = useState<PartRow[]>([{ name: '', quantity: '1', cost: '' }]);
  const [laborCost, setLaborCost] = useState('');
  const [answering, setAnswering] = useState<'accept' | 'reject' | 'reopen' | null>(null);
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [holdSubmitting, setHoldSubmitting] = useState(false);
  const [resuming, setResuming] = useState(false);
  const queryClient = useQueryClient();
  const now = useNow(request?.status === 'in_progress' && !!jobCard?.started_at);

  // Start the form from what's already on the job card, so re-completing a
  // reopened job doesn't overwrite the recorded parts and labor with blanks.
  // Re-runs when the status changes (resolved -> in_progress on reopen).
  useEffect(() => {
    if (!jobCard || request?.status !== 'in_progress') return;
    const savedParts = jobCard.parts_used ?? [];
    setParts(
      savedParts.length > 0
        ? savedParts.map((p) => ({ name: p.name, quantity: String(p.quantity), cost: String(p.cost) }))
        : [{ name: '', quantity: '1', cost: '' }]
    );
    setLaborCost(Number(jobCard.labor_cost) > 0 ? String(jobCard.labor_cost) : '');
  }, [jobCard?.id, jobCard?.updated_at, request?.status]);

  if (!isLoading && (isError || !request)) {
    // A withdrawn offer (or a job handed to someone else) is no longer
    // readable by this technician.
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 px-6">
        <Text className="text-center text-gray-500">This job is no longer available to you.</Text>
        <Pressable onPress={() => router.replace('/(technician)/dashboard')} className="mt-4">
          <Text className="font-semibold text-orange-600">Back to dashboard</Text>
        </Pressable>
      </View>
    );
  }

  if (isLoading || !request) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <Text className="text-gray-500">Loading…</Text>
      </View>
    );
  }

  const nextStatus = NEXT_STATUS[request.status];

  function updatePart(index: number, field: keyof PartRow, value: string) {
    setParts((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  }

  function addPart() {
    setParts((prev) => [...prev, { name: '', quantity: '1', cost: '' }]);
  }

  function removePart(index: number) {
    setParts((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleRespond(accept: boolean) {
    if (!request) return;
    setAnswering(accept ? 'accept' : 'reject');
    try {
      await respondToJobOffer(request.id, accept);
      await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
      await queryClient.invalidateQueries({ queryKey: ['job_cards'] });
      if (!accept) router.replace('/(technician)/dashboard');
    } catch (err) {
      showAlert(accept ? 'Could not accept' : 'Could not reject', getErrorMessage(err));
    } finally {
      setAnswering(null);
    }
  }

  function confirmReject() {
    showAlert('Reject this job?', 'It goes back to the reseller so they can offer it to someone else.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Reject', style: 'destructive', onPress: () => handleRespond(false) },
    ]);
  }

  function confirmReopen() {
    if (!request) return;
    showAlert(
      'Mark as not complete?',
      'The job goes back to in progress so you can finish it properly. You can mark it resolved again later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark not complete',
          onPress: async () => {
            setAnswering('reopen');
            try {
              await reopenCompletedJob(request.id);
              await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
              await queryClient.invalidateQueries({ queryKey: ['job_cards'] });
            } catch (err) {
              showAlert('Could not change', getErrorMessage(err));
            } finally {
              setAnswering(null);
            }
          },
        },
      ]
    );
  }

  async function handleRequestHold(note: string) {
    if (!request || !note.trim()) return;
    setHoldSubmitting(true);
    try {
      await requestJobHold(request.id, note.trim());
      await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
      setShowHoldModal(false);
    } catch (err) {
      showAlert('Could not request hold', getErrorMessage(err));
    } finally {
      setHoldSubmitting(false);
    }
  }

  async function handleResume() {
    if (!request) return;
    setResuming(true);
    try {
      await resumeJobHold(request.id);
      await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
    } catch (err) {
      showAlert('Could not resume', getErrorMessage(err));
    } finally {
      setResuming(false);
    }
  }

  async function handleAdvance() {
    if (!userId || !nextStatus || !request) return;
    try {
      if (request.status === 'in_progress') {
        const validParts = parts
          .filter((p) => p.name.trim())
          .map((p) => ({ name: p.name.trim(), quantity: Number(p.quantity) || 0, cost: Number(p.cost) || 0 }));
        const partsCost = validParts.reduce((sum, p) => sum + p.quantity * p.cost, 0);
        const values = {
          parts_used: validParts,
          labor_cost: Number(laborCost) || 0,
          parts_cost: partsCost,
          completed_at: new Date().toISOString(),
        };

        if (jobCard) {
          await updateJobCard.mutateAsync({ id: jobCard.id, values });
        } else {
          // No job card was opened (e.g. older data) - create one now.
          await insertJobCard.mutateAsync({ service_request_id: request.id, technician_id: userId, ...values });
        }
      }

      await updateRequest.mutateAsync({ id: request.id, values: { status: nextStatus } });
    } catch (err) {
      showAlert('Could not update job', getErrorMessage(err));
    }
  }

  const isSaving = updateRequest.isPending || insertJobCard.isPending || updateJobCard.isPending;

  const resellerName = reseller?.full_name;
  const resellerPhone = reseller?.phone;
  const hasResellerContact = hasAccepted && !!(resellerName || resellerPhone);

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
      <Text className="mb-1 text-xs text-gray-400">Job #{request.id.slice(0, 8).toUpperCase()}</Text>
      <View className="mb-4 flex-row items-center gap-3">
        <CategoryBadge category={request.issue_type} />
        <Text className="flex-1 text-2xl font-bold text-gray-900">{request.issue_type}</Text>
      </View>
      <Text className="mb-6 text-gray-600">{request.description}</Text>

      <StageStrip status={request.status} paid={request.payment_status === 'paid'} />

      <View className="mb-6 rounded-xl bg-white p-5">
        <Text className="text-sm uppercase tracking-wide text-gray-400">Current status</Text>
        <Text className="mt-1 text-lg font-semibold text-gray-900">
          {request.status === 'assigned'
            ? 'Offered to you - accept or reject'
            : request.status === 'in_progress'
              ? 'Work in progress'
              : request.status === 'resolved'
                ? request.payment_status === 'paid'
                  ? 'Completed and paid'
                  : 'Completed - waiting for payment'
                : request.status.replace('_', ' ')}
        </Text>
        {request.status === 'in_progress' && (
          <Text className="mt-1 text-xs text-gray-500">
            Finish the work, then tap "Mark job complete" at the bottom of this page.
          </Text>
        )}
        {request.status === 'in_progress' && jobCard?.started_at && (
          <View className="mt-3 rounded-lg bg-blue-50 p-3">
            <Text className="text-xs text-blue-900">
              <Text className="font-semibold">Accepted at: </Text>
              {formatTimestamp(jobCard.started_at)}
            </Text>
            <Text className="mt-1 text-xs font-bold text-blue-700">
              Time elapsed: {formatDuration(now - new Date(jobCard.started_at).getTime())}
            </Text>
          </View>
        )}
        {request.status === 'resolved' && jobCard?.completed_at && (
          <View className="mt-3 rounded-lg bg-gray-100 p-3">
            {jobCard.started_at && (
              <Text className="text-xs text-gray-700">
                <Text className="font-semibold">Accepted at: </Text>
                {formatTimestamp(jobCard.started_at)}
              </Text>
            )}
            <Text className="mt-1 text-xs text-gray-700">
              <Text className="font-semibold">Completed at: </Text>
              {formatTimestamp(jobCard.completed_at)}
            </Text>
            {jobCard.started_at && (
              <Text className="mt-1 text-xs font-bold text-gray-800">
                Time elapsed: {formatDuration(new Date(jobCard.completed_at).getTime() - new Date(jobCard.started_at).getTime())}
              </Text>
            )}
          </View>
        )}
        {request.quoted_price != null && (
          <Text className="mt-2 text-sm text-gray-500">
            Quoted price: NPR {Number(request.quoted_price).toLocaleString()}
          </Text>
        )}
      </View>

      {request.hold_status === 'requested' && (
        <View className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <View className="flex-row items-center gap-2">
            <Ionicons name="pause-circle" size={18} color="#92400E" />
            <Text className="text-sm font-semibold text-amber-900">Hold requested - waiting for the reseller</Text>
          </View>
          {!!request.hold_note && <Text className="mt-2 text-xs italic leading-[17px] text-amber-800">"{request.hold_note}"</Text>}
        </View>
      )}

      {request.hold_status === 'on_hold' && (
        <View className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <View className="flex-row items-center gap-2">
            <Ionicons name="pause-circle" size={18} color="#92400E" />
            <Text className="text-sm font-semibold text-amber-900">Job on hold</Text>
          </View>
          {!!request.hold_note && <Text className="mt-2 text-xs italic leading-[17px] text-amber-800">"{request.hold_note}"</Text>}
          <Pressable
            onPress={handleResume}
            disabled={resuming}
            className="mt-3 flex-row items-center justify-center gap-2 rounded-lg bg-amber-600 py-2.5 disabled:opacity-50"
          >
            <Ionicons name="play" size={16} color="#fff" />
            <Text className="text-sm font-semibold text-white">{resuming ? 'Resuming…' : 'Resume work'}</Text>
          </Pressable>
        </View>
      )}

      {hasResellerContact && (
        <View className="mb-6 rounded-xl bg-white p-5">
          <Text className="mb-2 text-sm uppercase tracking-wide text-gray-400">Reseller</Text>
          <View className="flex-row items-center gap-3">
            <PersonAvatar name={resellerName} photoUrl={reseller?.avatar_url} size={40} bg="bg-orange-500" />
            <View className="flex-1">
              {resellerName && <Text className="text-sm font-semibold text-gray-900">{resellerName}</Text>}
              {resellerPhone && <Text className="mt-0.5 text-sm text-gray-500">{resellerPhone}</Text>}
            </View>
          </View>
          {resellerPhone && (
            <View className="mt-3 flex-row gap-2">
              <Pressable
                onPress={() => Linking.openURL(`sms:${resellerPhone}`)}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-teal-50 py-2.5"
              >
                <Ionicons name="chatbubble-outline" size={15} color="#0F766E" />
                <Text className="text-sm font-semibold text-teal-700">Message</Text>
              </Pressable>
              <Pressable
                onPress={() => Linking.openURL(`tel:${resellerPhone}`)}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-orange-50 py-2.5"
              >
                <Ionicons name="call-outline" size={15} color="#1d4ed8" />
                <Text className="text-sm font-semibold text-orange-700">Call Reseller</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {!hasAccepted && (
        <View className="mb-6 flex-row items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-white p-4">
          <Ionicons name="lock-closed-outline" size={16} color="#9CA3AF" />
          <Text className="flex-1 text-xs text-gray-400">
            Reseller and customer contact details unlock once you start this job.
          </Text>
        </View>
      )}

      <RequestDetailsExtras
        scheduledDate={request.scheduled_date}
        scheduledTime={request.scheduled_time}
        location={request.location_data}
        photoUrls={request.photo_urls}
        customerName={hasAccepted ? request.customer_name ?? customer?.full_name : undefined}
        customerPhone={hasAccepted ? request.customer_phone ?? customer?.phone : undefined}
        contactPersonName={hasAccepted ? request.contact_person_name : undefined}
        contactPersonPhone={hasAccepted ? request.contact_person_phone : undefined}
      />

      {request.remark && (
        <View className="mb-6 mt-4 rounded-xl bg-white p-5">
          <Text className="mb-2 text-sm uppercase tracking-wide text-gray-400">Remark</Text>
          <Text className="text-sm text-gray-700">{request.remark}</Text>
        </View>
      )}

      {hasAccepted && (
        <View className="mb-6 rounded-xl bg-white p-5">
          <ChalanPhotos
            chalanUrls={request.chalan_urls}
            requestId={request.id}
            userId={userId}
            editable
            onUploaded={(urls) => updateRequest.mutateAsync({ id: request.id, values: { chalan_urls: urls } })}
          />
        </View>
      )}

      {request.status === 'in_progress' && (
        <View className="mb-6 rounded-xl bg-white p-5">
          {request.quoted_price != null && Number(request.quoted_price) > 0 && (
            <Text className="mb-3 text-xs leading-[17px] text-gray-500">
              The customer pays the agreed price of NPR {Number(request.quoted_price).toLocaleString()}. Record parts
              and labor here for the job record - if the job needs more, ask the reseller before going ahead.
            </Text>
          )}
          <Text className="mb-3 text-sm font-semibold text-gray-900">Parts used</Text>
          {parts.map((part, index) => (
            <View key={index} className="mb-2 flex-row items-center gap-2">
              <TextInput
                value={part.name}
                onChangeText={(v) => updatePart(index, 'name', v)}
                placeholder="Part name"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <TextInput
                value={part.quantity}
                onChangeText={(v) => updatePart(index, 'quantity', digitsInput(v))}
                placeholder="Qty"
                keyboardType="numeric"
                className="w-16 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <TextInput
                value={part.cost}
                onChangeText={(v) => updatePart(index, 'cost', decimalInput(v))}
                placeholder="Cost"
                keyboardType="numeric"
                className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <Pressable onPress={() => removePart(index)} className="items-center justify-center px-2 py-2">
                <Text className="text-red-600">✕</Text>
              </Pressable>
            </View>
          ))}
          <Pressable onPress={addPart} className="mb-4 self-start">
            <Text className="text-sm font-semibold text-orange-600">+ Add part</Text>
          </Pressable>

          <Text className="mb-1 text-sm font-semibold text-gray-900">Labor cost (NPR)</Text>
          <TextInput
            value={laborCost}
            onChangeText={(v) => setLaborCost(decimalInput(v))}
            placeholder="0"
            keyboardType="numeric"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </View>
      )}

      {request.status === 'assigned' && (
        <View className="mb-4 flex-row" style={{ gap: 12 }}>
          <Pressable
            onPress={confirmReject}
            disabled={!!answering}
            className="h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl disabled:opacity-60"
            style={{ backgroundColor: '#DC2626' }}
          >
            <Ionicons name="close" size={22} color="#fff" />
            <Text className="text-base font-bold text-white">{answering === 'reject' ? 'Rejecting…' : 'Reject'}</Text>
          </Pressable>
          <Pressable
            onPress={() => handleRespond(true)}
            disabled={!!answering}
            className="h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl disabled:opacity-60"
            style={{ backgroundColor: '#16A34A' }}
          >
            <Ionicons name="checkmark" size={22} color="#fff" />
            <Text className="text-base font-bold text-white">{answering === 'accept' ? 'Accepting…' : 'Accept'}</Text>
          </Pressable>
        </View>
      )}

      {nextStatus && request.hold_status !== 'on_hold' && (
        <Pressable
          onPress={handleAdvance}
          disabled={isSaving}
          className="mb-4 items-center rounded-lg bg-orange-500 py-3 disabled:opacity-50"
        >
          <Text className="text-base font-semibold text-white">
            {isSaving ? 'Updating…' : STATUS_ACTION_LABEL[request.status]}
          </Text>
        </Pressable>
      )}

      {request.status === 'in_progress' && request.hold_status === 'none' && (
        <Pressable
          onPress={() => setShowHoldModal(true)}
          className="mb-4 flex-row items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white py-3"
        >
          <Ionicons name="pause-circle-outline" size={18} color="#92400E" />
          <Text className="text-base font-semibold text-amber-900">Hold</Text>
        </Pressable>
      )}

      <HoldRequestModal
        visible={showHoldModal}
        submitting={holdSubmitting}
        onSubmit={handleRequestHold}
        onClose={() => setShowHoldModal(false)}
      />

      {request.status === 'resolved' && request.payment_status !== 'paid' && (
        <View className="mb-4 flex-row items-center gap-2.5 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <Ionicons name="cash-outline" size={18} color="#1D4ED8" />
          <Text className="flex-1 text-xs leading-[17px] text-blue-900">
            Job marked complete. It closes once the reseller collects the payment.
          </Text>
        </View>
      )}

      {request.status === 'resolved' && request.payment_status === 'paid' && (
        <View className="mb-4 flex-row items-center gap-2.5 rounded-xl border border-green-200 bg-green-50 p-4">
          <Ionicons name="checkmark-done-circle" size={18} color="#15803D" />
          <Text className="flex-1 text-xs leading-[17px] text-green-900">Paid - this job is closed.</Text>
        </View>
      )}

      {request.status === 'resolved' && request.payment_status !== 'paid' && (
        <View className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <Text className="text-sm font-semibold text-amber-900">Marked complete by mistake?</Text>
          <Text className="mt-0.5 text-xs text-amber-800">
            You can undo it while the job is still unpaid - it goes back to in progress.
          </Text>
          <Pressable
            onPress={confirmReopen}
            disabled={!!answering}
            className="mt-3 flex-row items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white py-2.5 disabled:opacity-50"
          >
            <Ionicons name="arrow-undo" size={16} color="#92400E" />
            <Text className="text-sm font-semibold text-amber-900">
              {answering === 'reopen' ? 'Updating…' : 'Mark as not complete'}
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
