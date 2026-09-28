// app/(reseller)/request/[id].tsx
import { useState, type ReactNode } from 'react';
import { View, Text, TextInput, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../../lib/hooks/useAuth';
import { useSupabaseRow, useSupabaseUpdate, useSupabaseQuery } from '../../../lib/hooks/useSupabase';
import { useRankedTechnicians } from '../../../lib/hooks/useTechnicianRanking';
import { RequestPhotos } from '../../../lib/components/RequestDetailsExtras';
import { TechnicianPicker } from '../../../lib/components/TechnicianPicker';
import { CategoryBadge } from '../../../lib/components/CategoryBadge';
import { ChalanPhotos } from '../../../lib/components/ChalanPhotos';
import { PaymentQrModal } from '../../../lib/components/PaymentQrModal';
import { ChatThread } from '../../../lib/components/ChatThread';
import { formatScheduledWhen } from '../../../lib/utils/scheduledTime';
import {
  DetailShell,
  DetailHero,
  DetailCard,
  DetailTimeline,
  NextStepCard,
  DetailButton,
  PersonRow,
  initialsOf,
  useWideDetail,
  ScrollTarget,
  useDetailScroll,
  type TimelineStep,
} from '../../../lib/components/detail/DetailLayout';
import { showAlert, getErrorMessage } from '../../../lib/utils/alert';
import { PaymentStatusSheet, PaymentChip, setJobPayment } from '../../../lib/components/PaymentStatusSheet';
import { parseAmount } from '../../../lib/utils/number';
import { assignTechnician, showJobSentAlert } from '../../../lib/utils/assignTechnician';
import { reopenCompletedJob, withdrawJobOffer, claimServiceRequest } from '../../../lib/hooks/useJobOffers';
import { respondToJobHold } from '../../../lib/hooks/useJobHold';
import { distanceKm } from '../../../lib/utils/distance';
import { jobAmountDue } from '../../../lib/utils/jobAmount';
import type { ServiceRequest } from '../../../types/database.types';

function money(value: number | null | undefined): string {
  return value != null ? `NPR ${Number(value).toLocaleString()}` : 'Not set';
}

/** How far along the job is - the same list on every state, so the reseller
 * always sees the whole path and where it currently stands. */
function stepsFor(request: ServiceRequest): TimelineStep[] {
  const isApp = request.origin === 'app';
  const s = request.status;
  const quoted = s === 'quoted' || s === 'approved' || s === 'assigned' || s === 'in_progress' || s === 'resolved';
  const approved = s === 'approved' || s === 'assigned' || s === 'in_progress' || s === 'resolved';
  const assigned = s === 'assigned' || s === 'in_progress' || s === 'resolved';
  const finished = s === 'resolved';
  const paid = request.payment_status === 'paid';

  const steps: TimelineStep[] = [{ label: 'Request created', done: true }];
  if (isApp) {
    steps.push(
      { label: 'Quote sent', meta: quoted ? money(request.quoted_price) : 'Waiting on you', done: quoted, now: !quoted },
      { label: 'Customer approved', meta: approved ? null : quoted ? 'Waiting on the customer' : null, done: approved, now: quoted && !approved }
    );
  } else {
    steps.push({ label: 'Price agreed', meta: money(request.quoted_price), done: quoted || approved || assigned });
  }
  steps.push(
    { label: 'Technician assigned', meta: assigned ? null : approved ? 'Waiting on you' : null, done: assigned, now: approved && !assigned },
    { label: 'Job finished', meta: finished ? null : s === 'assigned' ? 'Waiting for the technician to accept' : assigned ? 'Technician is working' : null, done: finished, now: assigned && !finished },
    { label: 'Payment collected', meta: paid ? 'Paid in full' : finished ? 'Waiting on you' : null, done: paid, now: finished && !paid }
  );
  return steps;
}

function JobHero({
  request,
  pill,
  amount,
  amountLabel,
  customerName,
  customerPhone,
  customerPhoto,
  phoneLocked,
  technicianName,
  onMessage,
}: {
  request: ServiceRequest;
  pill: string;
  amount: string;
  amountLabel: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerPhoto?: string | null;
  /** Unclaimed requests hide the number until the job is accepted. */
  phoneLocked?: boolean;
  technicianName?: string | null;
  onMessage?: () => void;
}) {
  const wide = useWideDetail();
  const { scrollTo } = useDetailScroll();
  const location = request.location_data;
  const when = formatScheduledWhen(request.scheduled_date, request.scheduled_time);
  const hasCoords = location?.latitude != null && location?.longitude != null;
  const showContact =
    !!request.contact_person_name && request.contact_person_name.trim() !== (customerName ?? '').trim();

  return (
    <DetailHero
      wide={wide}
      tone="blue"
      icon={
        <View className="rounded-2xl bg-white p-1">
          <CategoryBadge category={request.issue_type} size={wide ? 54 : 46} />
        </View>
      }
      title={request.issue_type}
      pill={pill}
      subtitle={request.origin === 'app' ? 'App customer' : 'Your own customer'}
      amount={amount}
      amountLabel={amountLabel}
      facts={[
        {
          icon: 'person-outline' as const,
          label: 'Customer',
          value: customerName ?? 'Customer',
          sub: phoneLocked ? 'Phone unlocks when you accept' : customerPhone,
          photoUrl: customerPhoto,
        },
        ...(technicianName
          ? [{ icon: 'construct-outline' as const, label: 'Technician', value: technicianName }]
          : []),
        ...(when ? [{ icon: 'calendar-outline' as const, label: 'When', value: when }] : []),
        ...(location?.address
          ? [
              {
                icon: 'location-outline' as const,
                label: 'Where',
                value: location.address,
                sub: request.company_name,
                onPress: hasCoords
                  ? () => Linking.openURL(`https://www.google.com/maps?q=${location.latitude},${location.longitude}`)
                  : undefined,
              },
            ]
          : []),
        ...(showContact
          ? [
              {
                icon: 'person-circle-outline' as const,
                label: 'Contact',
                value: request.contact_person_name!,
                sub: request.contact_person_phone,
              },
            ]
          : []),
      ]}
      actions={
        customerPhone ? (
          <>
            <HeroIconButton
              icon="call-outline"
              label="Call customer"
              onPress={() => Linking.openURL(`tel:${customerPhone}`)}
            />
            <HeroIconButton
              icon="chatbubble-outline"
              label="Message customer"
              onPress={() => {
                scrollTo('messages');
                onMessage?.();
              }}
            />
          </>
        ) : null
      }
    />
  );
}

/** Call / message on the coloured band, so the customer's details and the
 * ways to reach them live in one place instead of a card of their own. */
function HeroIconButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-10 w-10 items-center justify-center rounded-full"
      style={{ backgroundColor: 'rgba(255,255,255,0.22)' }}
    >
      <Ionicons name={icon} size={18} color="#fff" />
    </Pressable>
  );
}

function ProblemCard({ request }: { request: ServiceRequest }) {
  const wide = useWideDetail();
  if (!request.description && request.photo_urls.length === 0) return null;
  return (
    <DetailCard wide={wide} icon="document-text-outline" title="What the customer says">
      {!!request.description && (
        <Text className="text-[14.5px] leading-[22px] text-gray-700">{request.description}</Text>
      )}
      <RequestPhotos photoUrls={request.photo_urls} />
    </DetailCard>
  );
}

function RemarkCard({ remark }: { remark: string | null }) {
  const wide = useWideDetail();
  if (!remark) return null;
  return (
    <DetailCard wide={wide} icon="chatbox-ellipses-outline" title="Your remark for the technician">
      <Text className="text-[14px] leading-[21px] text-gray-700">{remark}</Text>
    </DetailCard>
  );
}

/** The customer chat for this job - the same thread the customer sees in
 * their own app, so "Message" never has to leave for SMS. */
function MessagesCard({ requestId, focusToken }: { requestId: string; focusToken: number }) {
  const wide = useWideDetail();
  return (
    <ScrollTarget name="messages">
      <DetailCard wide={wide} icon="chatbubble-outline" title="Messages">
        <ChatThread subjectType="service_request" subjectId={requestId} focusToken={focusToken} />
      </DetailCard>
    </ScrollTarget>
  );
}

function HoldCard({ request }: { request: ServiceRequest }) {
  const wide = useWideDetail();
  const queryClient = useQueryClient();
  const [responding, setResponding] = useState(false);

  async function respond(approve: boolean) {
    setResponding(true);
    try {
      await respondToJobHold(request.id, approve);
      await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
    } catch (err) {
      showAlert('Could not respond', getErrorMessage(err));
    } finally {
      setResponding(false);
    }
  }

  if (request.status !== 'in_progress') return null;

  if (request.hold_status === 'requested') {
    return (
      <DetailCard wide={wide} icon="pause-circle-outline" title="Hold request">
        <Text className="text-[13.5px] leading-5 text-gray-700">
          The technician wants to pause this job{request.hold_note ? ':' : '.'}
        </Text>
        {!!request.hold_note && (
          <Text className="mt-1.5 text-[13.5px] italic leading-5 text-gray-600">"{request.hold_note}"</Text>
        )}
        <View className="mt-3.5 flex-row gap-2">
          <DetailButton label="Reject" icon="close" kind="red" disabled={responding} onPress={() => respond(false)} />
          <DetailButton
            label={responding ? 'Working…' : 'Accept hold'}
            icon="checkmark"
            kind="primary"
            disabled={responding}
            onPress={() => respond(true)}
          />
        </View>
      </DetailCard>
    );
  }

  if (request.hold_status === 'on_hold') {
    return (
      <DetailCard wide={wide} icon="pause-circle-outline" title="On hold">
        <Text className="text-[13.5px] leading-5 text-gray-700">
          You approved this hold - the technician will resume work on their own.
        </Text>
        {!!request.hold_note && (
          <Text className="mt-1.5 text-[13.5px] italic leading-5 text-gray-600">"{request.hold_note}"</Text>
        )}
      </DetailCard>
    );
  }

  return null;
}

function ProgressCard({ request }: { request: ServiceRequest }) {
  const wide = useWideDetail();
  return (
    <DetailCard wide={wide} icon="time-outline" title="Progress">
      <DetailTimeline steps={stepsFor(request)} />
    </DetailCard>
  );
}

function MobileBar({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <>
      <View className="flex-1">
        <Text className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Next step</Text>
        <Text className="text-[13.5px] font-bold text-gray-900" numberOfLines={1}>
          {hint}
        </Text>
      </View>
      <View style={{ minWidth: 168 }}>{children}</View>
    </>
  );
}

// ---------------------------------------------------------------- states

function JobTracking({ request }: { request: ServiceRequest }) {
  // A "reseller" origin request's client_id is just the reseller's own id
  // (there's no real customer profile behind it), so only look up a photo
  // for real app customers.
  const { data: customer } = useSupabaseRow('profiles', request.origin === 'app' ? request.client_id : undefined);
  const { data: technician } = useSupabaseRow('profiles', request.technician_id ?? undefined);
  const { refetch } = useSupabaseRow('service_requests', request.id);
  const updateRequest = useSupabaseUpdate('service_requests');
  const [showQr, setShowQr] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const queryClient = useQueryClient();
  const { data: jobCards } = useSupabaseQuery('job_cards', { filters: { service_request_id: request.id } });
  // What the customer actually pays - the same amount the QR charges and
  // the ledger records.
  const amountDue = jobAmountDue(request.quoted_price, jobCards?.[0]);

  function confirmWithdraw() {
    showAlert(
      'Take this job back?',
      "The technician hasn't answered yet. The job comes back to you so you can offer it to someone else.",
      [
        { text: 'Keep waiting', style: 'cancel' },
        {
          text: 'Take it back',
          style: 'destructive',
          onPress: async () => {
            setWithdrawing(true);
            try {
              await withdrawJobOffer(request.id);
              await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
            } catch (err) {
              showAlert('Could not take it back', getErrorMessage(err));
            } finally {
              setWithdrawing(false);
            }
          },
        },
      ]
    );
  }

  function confirmReopen() {
    showAlert(
      'Reopen this job?',
      'It goes back to "Job in progress" so the technician can finish it. You can collect payment once it is marked complete again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reopen job',
          onPress: async () => {
            setReopening(true);
            try {
              await reopenCompletedJob(request.id);
              await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
            } catch (err) {
              showAlert('Could not reopen', getErrorMessage(err));
            } finally {
              setReopening(false);
            }
          },
        },
      ]
    );
  }
  const wide = useWideDetail();
  const [chatFocus, setChatFocus] = useState(0);

  const paid = request.payment_status === 'paid';
  const partlyPaid = request.payment_status === 'partial';
  const finished = request.status === 'resolved';
  const cancelled = request.status === 'cancelled';
  const canCollect = finished && !paid;
  const [showPayment, setShowPayment] = useState(false);
  const awaitingAnswer = request.status === 'assigned';

  const customerName = request.customer_name ?? customer?.full_name;
  const customerPhone = request.customer_phone ?? customer?.phone;

  const distance =
    request.location_data?.latitude != null &&
    request.location_data?.longitude != null &&
    technician?.latitude != null &&
    technician?.longitude != null
      ? distanceKm(
          { latitude: request.location_data.latitude, longitude: request.location_data.longitude },
          { latitude: technician.latitude, longitude: technician.longitude }
        )
      : null;

  async function handleMarkPaid() {
    try {
      // Goes through set_job_payment like every other payment change, so
      // the ledger entry and the amount received stay in step whoever
      // makes the change (migration 0078).
      await setJobPayment(request.id, 'paid');
      refetch();
    } catch (err) {
      showAlert('Could not update', getErrorMessage(err));
    }
  }

  function handlePaid() {
    setShowQr(false);
    showAlert('Payment received', 'Fonepay confirmed the payment — this job is now fully paid.');
    refetch();
  }

  const pill = cancelled
    ? 'Cancelled'
    : paid
      ? 'Completed'
      : partlyPaid
        ? 'Part paid'
        : finished
          ? 'Awaiting payment'
          : 'Job in progress';
  const amountLabel = paid ? 'Paid' : finished ? 'To collect' : 'Job value';

  const markPaidButton = (
    <DetailButton
      label={updateRequest.isPending ? 'Updating…' : 'Mark cash as paid'}
      icon="checkmark-circle"
      disabled={updateRequest.isPending}
      onPress={handleMarkPaid}
    />
  );

  return (
    <DetailShell
      bottomBar={canCollect ? <MobileBar hint={`Collect ${money(amountDue)}`}>{markPaidButton}</MobileBar> : null}
      right={
        <>
          {canCollect && (
            <NextStepCard
              wide={wide}
              title={`Collect ${money(amountDue)}`}
              hint={
                request.payment_method === 'online'
                  ? 'Online payments update on their own once Fonepay confirms - mark cash paid only if they pay you in person.'
                  : 'The customer pays you directly - mark it paid once you have collected it.'
              }
            >
              {/* On a phone the same button is already pinned to the bottom bar. */}
              {wide && markPaidButton}
              <DetailButton label="Show QR to pay online" icon="qr-code-outline" kind="ghost" height={42} onPress={() => setShowQr(true)} />
              <DetailButton
                label={partlyPaid ? `Part paid · ${money(Number(request.amount_paid ?? 0))} in` : 'Record a part payment'}
                icon="contrast-outline"
                kind="ghost"
                height={42}
                onPress={() => setShowPayment(true)}
              />
              <Pressable onPress={confirmReopen} disabled={reopening} className="items-center py-1.5 disabled:opacity-50">
                <Text className="text-[12.5px] font-semibold text-amber-700">
                  {reopening ? 'Reopening…' : 'Marked complete by mistake? Reopen job'}
                </Text>
              </Pressable>
            </NextStepCard>
          )}
          {awaitingAnswer && (
            <NextStepCard
              wide={wide}
              title="Waiting for the technician to accept"
              hint="No answer? Take the job back and offer it to someone else."
            >
              <DetailButton
                label={withdrawing ? 'Taking it back…' : 'Take job back'}
                icon="arrow-undo"
                kind="ghost"
                height={42}
                disabled={withdrawing}
                onPress={confirmWithdraw}
              />
            </NextStepCard>
          )}
          {!finished && !cancelled && !awaitingAnswer && (
            <NextStepCard
              wide={wide}
              title="Wait for the job to finish"
              hint="You can collect payment once the technician marks the job done."
            />
          )}
          <ProgressCard request={request} />
        </>
      }
    >
      <JobHero
        request={request}
        pill={pill}
        amount={money(amountDue)}
        amountLabel={amountLabel}
        customerName={customerName}
        customerPhone={customerPhone}
        customerPhoto={customer?.avatar_url}
        onMessage={() => setChatFocus((n) => n + 1)}
        technicianName={technician?.full_name}
      />

      <HoldCard request={request} />

      {!!technician && (
        <DetailCard wide={wide} icon="construct-outline" title="Technician">
          <PersonRow
            name={technician.full_name ?? 'Technician'}
            sub={distance != null ? `${distance.toFixed(1)} km from the job` : technician.phone}
            initials={initialsOf(technician.full_name)}
            photoUrl={technician.avatar_url}
            bg="#DCFCE7"
            fg="#15803D"
          >
            {!!technician.phone && (
              <View style={{ width: 110 }}>
                <DetailButton
                  label="Call"
                  icon="call-outline"
                  kind="ghost"
                  height={40}
                  onPress={() => Linking.openURL(`tel:${technician.phone}`)}
                />
              </View>
            )}
          </PersonRow>
        </DetailCard>
      )}

      <ProblemCard request={request} />
      <RemarkCard remark={request.remark} />

      {request.chalan_urls.length > 0 && (
        <DetailCard wide={wide} icon="document-attach-outline" title="Chalan">
          <ChalanPhotos chalanUrls={request.chalan_urls} requestId={request.id} editable={false} onUploaded={() => {}} />
        </DetailCard>
      )}

      <PaymentQrModal visible={showQr} serviceRequestId={request.id} onClose={() => setShowQr(false)} onPaid={handlePaid} />
      <PaymentStatusSheet
        visible={showPayment}
        request={request}
        total={Number(amountDue ?? 0) + Number(request.amount_paid ?? 0) || Number(request.quoted_price ?? 0)}
        onClose={() => {
          setShowPayment(false);
          refetch();
        }}
      />
      <MessagesCard requestId={request.id} focusToken={chatFocus} />
    </DetailShell>
  );
}

// Reseller brought in their own (offline) customer - they've already agreed
// on the job and price directly, so there's no app-side customer to approve
// anything. Price and technician assignment happen together in one step.
function SelfSourcedAssign({ request, userId }: { request: ServiceRequest; userId: string }) {
  const [quotedPrice, setQuotedPrice] = useState(request.quoted_price != null ? String(request.quoted_price) : '');
  const { rankedTechnicians, isLoading: loadingTechs } = useRankedTechnicians(request.location_data, userId);
  const queryClient = useQueryClient();
  const [assigning, setAssigning] = useState(false);
  const wide = useWideDetail();
  const [chatFocus, setChatFocus] = useState(0);

  async function handleAssign(technicianId: string) {
    const price = parseAmount(quotedPrice);
    if (quotedPrice.trim() && (price == null || price <= 0)) {
      showAlert('Invalid price', 'Enter a valid price in NPR, or leave it blank.');
      return;
    }
    setAssigning(true);
    try {
      await assignTechnician({
        requestId: request.id,
        technicianId,
        extraValues: { quoted_price: price, reseller_id: userId },
      });
      queryClient.invalidateQueries({ queryKey: ['service_requests'] });
      showJobSentAlert(rankedTechnicians.find((t) => t.id === technicianId)?.full_name);
      router.replace('/(reseller)/requests');
    } catch (err) {
      showAlert('Could not assign', getErrorMessage(err));
    } finally {
      setAssigning(false);
    }
  }

  return (
    <DetailShell
      right={
        <>
          <NextStepCard
            wide={wide}
            title="Pick a technician"
            hint="Set your price first if you know it, then choose who does the job."
          />
          <ProgressCard request={request} />
        </>
      }
    >
      <JobHero
        request={request}
        pill="Assign a technician"
        amount={money(request.quoted_price)}
        amountLabel="Your price"
        customerName={request.customer_name}
        customerPhone={request.customer_phone}
        onMessage={() => setChatFocus((n) => n + 1)}
      />

      <ProblemCard request={request} />

      <DetailCard wide={wide} icon="pricetag-outline" title="Your price">
        <Text className="mb-2.5 text-xs text-gray-400">Optional — you can leave it blank and price it later.</Text>
        <View className="flex-row items-center gap-2 rounded-lg border border-gray-300 bg-white px-4">
          <Text className="text-base font-semibold text-gray-500">NPR</Text>
          <TextInput
            value={quotedPrice}
            onChangeText={setQuotedPrice}
            placeholder="e.g. 2000"
            keyboardType="numeric"
            className="flex-1 py-3 text-base"
          />
        </View>
      </DetailCard>

      <DetailCard wide={wide} icon="people-outline" title="Choose a technician">
        <TechnicianPicker
          technicians={rankedTechnicians}
          isLoading={loadingTechs}
          locationKnown={request.location_data?.latitude != null}
          onAssign={handleAssign}
          disabled={assigning}
        />
      </DetailCard>
      <MessagesCard requestId={request.id} focusToken={chatFocus} />
    </DetailShell>
  );
}

// Any reseller can see this pending app request in their Incoming queue, so
// customer contact stays hidden until one of them claims it - claiming just
// stamps reseller_id, which pulls it into that reseller's My Jobs tab.
function AcceptIncomingRequest({ request }: { request: ServiceRequest }) {
  // Only what the card shows - the phone number stays out of the app until
  // this reseller has claimed the job.
  const { data: customer } = useSupabaseRow('profiles', request.client_id, 'id, full_name, avatar_url');
  const queryClient = useQueryClient();
  const [accepting, setAccepting] = useState(false);
  const wide = useWideDetail();
  const [chatFocus, setChatFocus] = useState(0);

  async function handleAccept() {
    setAccepting(true);
    try {
      await claimServiceRequest(request.id);
    } catch (err) {
      showAlert('Could not accept job', getErrorMessage(err));
    } finally {
      // Refetch either way - on a lost race this shows who has it now.
      await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
      setAccepting(false);
    }
  }

  const acceptButton = (
    <DetailButton
      label={accepting ? 'Accepting…' : 'Accept this job'}
      icon="checkmark-circle"
      kind="green"
      disabled={accepting}
      onPress={handleAccept}
    />
  );

  return (
    <DetailShell
      bottomBar={<MobileBar hint="Accept this job">{acceptButton}</MobileBar>}
      right={
        <>
          <NextStepCard
            wide={wide}
            title="Accept this job"
            hint="Accepting claims it for you and unlocks the customer's phone number."
          >
            {acceptButton}
          </NextStepCard>
          <ProgressCard request={request} />
        </>
      }
    >
      <JobHero
        request={request}
        pill="New request"
        amount="Not set"
        amountLabel="Your price"
        customerName={request.customer_name ?? customer?.full_name}
        customerPhoto={customer?.avatar_url}
        phoneLocked
        onMessage={() => setChatFocus((n) => n + 1)}
      />
      <ProblemCard request={request} />
      <MessagesCard requestId={request.id} focusToken={chatFocus} />
    </DetailShell>
  );
}

// App-sourced request: the reseller calls the customer directly, confirms
// exactly what's wrong, writes that up as a remark for the technician - then
// the customer approves the price before a technician can be assigned.
function SendQuote({ request, userId }: { request: ServiceRequest; userId: string }) {
  const { data: customer } = useSupabaseRow('profiles', request.client_id);
  const [quotedPrice, setQuotedPrice] = useState('');
  const [remark, setRemark] = useState('');
  const updateRequest = useSupabaseUpdate('service_requests');
  const wide = useWideDetail();
  const [chatFocus, setChatFocus] = useState(0);

  async function handleSendQuote() {
    const price = parseAmount(quotedPrice);
    if (price == null || price <= 0) {
      showAlert('Add a price', "Enter what you'd charge the customer before sending the quote.");
      return;
    }
    if (!remark.trim()) {
      showAlert('Add a remark', 'Call the customer, confirm the exact problem, and write it down first.');
      return;
    }
    try {
      await updateRequest.mutateAsync({
        id: request.id,
        values: { reseller_id: userId, quoted_price: price, remark: remark.trim(), status: 'quoted' },
      });
      showAlert('Quote sent', 'Waiting for the customer to approve it before you can assign a technician.');
      router.replace('/(reseller)/requests');
    } catch (err) {
      showAlert('Could not send quote', getErrorMessage(err));
    }
  }

  const sendButton = (
    <DetailButton
      label={updateRequest.isPending ? 'Sending…' : 'Send quote to customer'}
      icon="paper-plane-outline"
      disabled={updateRequest.isPending}
      onPress={handleSendQuote}
    />
  );

  const stepHead = (n: number, title: string, hint: string) => (
    <View className="mb-3.5 flex-row items-center gap-2.5">
      <View className="h-[26px] w-[26px] items-center justify-center rounded-full bg-amber-50">
        <Text className="text-[13px] font-extrabold text-amber-700">{n}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-base font-bold text-gray-900">{title}</Text>
        <Text className="text-[12.5px] text-gray-400">{hint}</Text>
      </View>
    </View>
  );

  return (
    <DetailShell
      bottomBar={<MobileBar hint="Send the quote">{sendButton}</MobileBar>}
      right={
        <>
          <NextStepCard wide={wide} title="Send the quote" hint="Needs the problem written down and a price.">
            {sendButton}
          </NextStepCard>
          <ProgressCard request={request} />
        </>
      }
    >
      <JobHero
        request={request}
        pill="Needs a quote"
        amount="Not set"
        amountLabel="Your price"
        customerName={customer?.full_name}
        customerPhone={customer?.phone}
        customerPhoto={customer?.avatar_url}
        onMessage={() => setChatFocus((n) => n + 1)}
      />

      <ProblemCard request={request} />

      <DetailCard wide={wide}>
        {stepHead(1, 'Call the customer, then write what is wrong', 'The technician reads this before going')}
        <TextInput
          value={remark}
          onChangeText={setRemark}
          placeholder="e.g. Printer jams on every print, roller looks worn out"
          multiline
          numberOfLines={4}
          className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-[15px]"
          style={{ minHeight: 92, textAlignVertical: 'top' }}
        />

        <View className="mt-5">
          {stepHead(2, 'Set your price', 'The customer must approve it before you can assign anyone')}
        </View>
        <View className="w-60 flex-row items-center gap-2 rounded-lg border border-gray-300 bg-white px-4">
          <Text className="text-base font-semibold text-gray-500">NPR</Text>
          <TextInput
            value={quotedPrice}
            onChangeText={setQuotedPrice}
            placeholder="2,000"
            keyboardType="numeric"
            className="flex-1 py-3 text-base"
          />
        </View>
      </DetailCard>
      <MessagesCard requestId={request.id} focusToken={chatFocus} />
    </DetailShell>
  );
}

function WaitingForApproval({ request }: { request: ServiceRequest }) {
  const { data: customer } = useSupabaseRow('profiles', request.origin === 'app' ? request.client_id : undefined);
  const wide = useWideDetail();
  const [chatFocus, setChatFocus] = useState(0);
  const customerName = request.customer_name ?? customer?.full_name;
  const customerPhone = request.customer_phone ?? customer?.phone;

  return (
    <DetailShell
      right={
        <>
          <NextStepCard
            wide={wide}
            title="Waiting on the customer"
            hint="You can assign a technician as soon as they approve the price."
          >
            {!!customerPhone && (
              <DetailButton
                label="Call customer"
                icon="call-outline"
                kind="tint"
                onPress={() => Linking.openURL(`tel:${customerPhone}`)}
              />
            )}
          </NextStepCard>
          <ProgressCard request={request} />
        </>
      }
    >
      <JobHero
        request={request}
        pill="Waiting on customer"
        amount={money(request.quoted_price)}
        amountLabel="Quoted"
        customerName={customerName}
        customerPhone={customerPhone}
        customerPhoto={customer?.avatar_url}
        onMessage={() => setChatFocus((n) => n + 1)}
      />
      <ProblemCard request={request} />
      <RemarkCard remark={request.remark} />
      <MessagesCard requestId={request.id} focusToken={chatFocus} />
    </DetailShell>
  );
}

function ChooseTechnician({ request, userId }: { request: ServiceRequest; userId: string }) {
  const { data: customer } = useSupabaseRow('profiles', request.origin === 'app' ? request.client_id : undefined);
  const { rankedTechnicians, isLoading: loadingTechs } = useRankedTechnicians(request.location_data, userId);
  const queryClient = useQueryClient();
  const [assigning, setAssigning] = useState(false);
  const wide = useWideDetail();
  const [chatFocus, setChatFocus] = useState(0);

  async function handleAssign(technicianId: string) {
    setAssigning(true);
    try {
      await assignTechnician({ requestId: request.id, technicianId });
      queryClient.invalidateQueries({ queryKey: ['service_requests'] });
      showJobSentAlert(rankedTechnicians.find((t) => t.id === technicianId)?.full_name);
      router.replace('/(reseller)/requests');
    } catch (err) {
      showAlert('Could not assign', getErrorMessage(err));
    } finally {
      setAssigning(false);
    }
  }

  return (
    <DetailShell
      right={
        <>
          <NextStepCard
            wide={wide}
            title="Pick a technician"
            hint={`The customer approved ${money(request.quoted_price)} — choose who does the job.`}
          />
          <ProgressCard request={request} />
        </>
      }
    >
      <JobHero
        request={request}
        pill="Ready to assign"
        amount={money(request.quoted_price)}
        amountLabel="Approved price"
        customerName={request.customer_name ?? customer?.full_name}
        customerPhone={request.customer_phone ?? customer?.phone}
        customerPhoto={customer?.avatar_url}
        onMessage={() => setChatFocus((n) => n + 1)}
      />

      <View className="flex-row items-center gap-2.5 rounded-2xl border border-green-200 bg-green-50 p-4">
        <Ionicons name="checkmark-circle" size={18} color="#15803D" />
        <Text className="flex-1 text-sm font-semibold text-green-700">
          Customer approved {money(request.quoted_price)} — pick a technician below.
        </Text>
      </View>

      <ProblemCard request={request} />
      <RemarkCard remark={request.remark} />

      <DetailCard wide={wide} icon="people-outline" title="Choose a technician">
        <TechnicianPicker
          technicians={rankedTechnicians}
          isLoading={loadingTechs}
          locationKnown={request.location_data?.latitude != null}
          onAssign={handleAssign}
          disabled={assigning}
        />
      </DetailCard>
      <MessagesCard requestId={request.id} focusToken={chatFocus} />
    </DetailShell>
  );
}

export default function ResellerRequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Hidden tab screens stay mounted between visits, so opening another
  // record reused this one's component state (typed quote/remark/price, a
  // "thanks for rating" flag, an open edit form...). Keying on the id gives
  // every record its own fresh state.
  return <ResellerRequestDetail key={id} id={id} />;
}

function ResellerRequestDetail({ id }: { id: string }) {
  const userId = useAuthStore((state) => state.session?.user.id);
  const { data: request, isLoading: loadingRequest } = useSupabaseRow('service_requests', id);

  if (loadingRequest || !request || !userId) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <Text className="text-gray-500">Loading…</Text>
      </View>
    );
  }

  const isMine = request.reseller_id === userId;

  if (request.status === 'pending') {
    if (request.origin === 'reseller') {
      if (!isMine) {
        return (
          <View className="flex-1 bg-gray-50 px-6 pt-4">
            <Text className="text-lg font-semibold text-gray-900">This is another reseller's customer.</Text>
          </View>
        );
      }
      return <SelfSourcedAssign request={request} userId={userId} />;
    }
    if (request.reseller_id && !isMine) {
      return (
        <View className="flex-1 bg-gray-50 px-6 pt-4">
          <Text className="text-lg font-semibold text-gray-900">Another reseller has already accepted this request.</Text>
        </View>
      );
    }
    if (!isMine) {
      return <AcceptIncomingRequest request={request} />;
    }
    return <SendQuote request={request} userId={userId} />;
  }

  if (request.status === 'quoted' && isMine) {
    return <WaitingForApproval request={request} />;
  }

  if (request.status === 'approved' && isMine) {
    return <ChooseTechnician request={request} userId={userId} />;
  }

  if (isMine) {
    return <JobTracking request={request} />;
  }

  return (
    <View className="flex-1 bg-gray-50 px-6 pt-4">
      <Text className="text-lg font-semibold text-gray-900">This request is already {request.status}.</Text>
      <Text className="mt-2 text-gray-500">Someone else may have claimed it already.</Text>
    </View>
  );
}
