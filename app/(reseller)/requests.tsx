// app/(reseller)/requests.tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, FlatList, ScrollView, Pressable, Platform, Linking, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { useSupabaseQuery, useSupabaseRow, useSupabaseUpdate, subscribeToTable } from '../../lib/hooks/useSupabase';
import { distanceKm } from '../../lib/utils/distance';
import { formatScheduledWhen } from '../../lib/utils/scheduledTime';
import { CategoryBadge } from '../../lib/components/CategoryBadge';
import { showAlert, getErrorMessage } from '../../lib/utils/alert';
import { STATUS_ACTION_LABEL } from '../../lib/utils/orderStatus';
import { WEB_SIDEBAR_MIN_WIDTH } from '../../lib/components/web/WebSidebarShell';
import type { Order, Product, ServiceRequest } from '../../types/database.types';

// "My Jobs" mixed every status (and payment state) into one flat list, so it
// was hard to tell what actually needed attention. Group by pipeline stage
// instead - what the reseller should be doing right now for that job. There
// used to be a separate "Needs your action" stage covering both "claimed,
// still needs a quote" and "approved, needs a technician" - the former now
// folds into "Waiting on customer" (the next step there is just to call the
// customer and send a quote), and the latter is its own "My Jobs" stage,
// right before "Job in progress" since picking a technician is the last
// thing standing between an approved job and it actually starting.
type Stage =
  | 'requests'
  | 'waiting_customer'
  | 'my_jobs'
  | 'in_progress'
  | 'completed'
  | 'awaiting_payment'
  | 'paid'
  | 'cancelled';

// Two quite different piles of work used to share one list: jobs customers
// asked you for, and jobs you raised yourself for your own customers. They
// need different first moves (answer one, staff the other), so they get a
// side each.
type Source = 'customers' | 'mine';

const SOURCE_META: Record<Source, { label: string; icon: keyof typeof Ionicons.glyphMap; blurb: string }> = {
  customers: { label: 'From customers', icon: 'download-outline', blurb: 'Service customers asked you for' },
  mine: { label: 'My requests', icon: 'megaphone-outline', blurb: 'Work you raised yourself' },
};

function SourceTabs({ value, onChange, counts }: { value: Source; onChange: (v: Source) => void; counts: Record<Source, number> }) {
  return (
    <View className="flex-row rounded-2xl bg-gray-200 p-1" style={{ gap: 4 }}>
      {(Object.keys(SOURCE_META) as Source[]).map((key) => {
        const meta = SOURCE_META[key];
        const active = value === key;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl px-3"
            style={{ height: 42, backgroundColor: active ? '#FFFFFF' : 'transparent' }}
          >
            <Ionicons name={meta.icon} size={16} color={active ? '#1D4ED8' : '#6B7280'} />
            <Text className={`text-[13.5px] ${active ? 'font-bold text-blue-700' : 'font-semibold text-gray-500'}`} numberOfLines={1}>
              {meta.label}
            </Text>
            <View
              className="h-5 min-w-5 items-center justify-center rounded-full px-1.5"
              style={{ backgroundColor: active ? '#1D4ED8' : '#9CA3AF' }}
            >
              <Text className="text-[11px] font-extrabold text-white">{counts[key]}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// The order the work actually happens in: the job finishes first, and only
// then is there money to chase. A job sits in Completed until something is
// received, moves to Awaiting payment once it is part paid, and leaves the
// pipeline altogether when it is paid in full.
const STAGE_ORDER: Stage[] = [
  'requests',
  'waiting_customer',
  'my_jobs',
  'in_progress',
  'completed',
  'awaiting_payment',
  'paid',
  'cancelled',
];
// The stages where there's still something to do - the numbered pipeline on
// web. Paid/Cancelled sit off to the side, since nothing is left to do.
const WORKING_STAGES: Stage[] = ['requests', 'waiting_customer', 'my_jobs', 'in_progress', 'completed', 'awaiting_payment'];

const STAGE_META: Record<
  Stage,
  { label: string; todo: string; icon: keyof typeof Ionicons.glyphMap; color: string; tint: string }
> = {
  requests: { label: 'Requests', todo: 'Accept or confirm', icon: 'download-outline', color: '#EA580C', tint: '#FFF7ED' },
  waiting_customer: { label: 'Waiting on customer', todo: 'Quote & wait for approval', icon: 'time-outline', color: '#D97706', tint: '#FFFBEB' },
  my_jobs: { label: 'My Jobs', todo: 'Assign a technician', icon: 'briefcase', color: '#2563EB', tint: '#EFF6FF' },
  in_progress: { label: 'Job in progress', todo: 'Technician is working', icon: 'build', color: '#2563EB', tint: '#EFF6FF' },
  completed: { label: 'Completed', todo: 'Work done - collect payment', icon: 'checkmark-circle', color: '#7C3AED', tint: '#F5F3FF' },
  awaiting_payment: { label: 'Awaiting payment', todo: 'Part paid - collect the rest', icon: 'cash-outline', color: '#DC2626', tint: '#FEF2F2' },
  paid: { label: 'Paid', todo: 'Paid & delivered', icon: 'checkmark-done-circle', color: '#16A34A', tint: '#F0FDF4' },
  cancelled: { label: 'Cancelled', todo: 'Nothing left to do', icon: 'close-circle', color: '#9CA3AF', tint: '#F3F4F6' },
};

function stageOf(item: ServiceRequest): Stage {
  switch (item.status) {
    case 'cancelled':
      return 'cancelled';
    case 'pending':
      // A self-sourced (reseller-posted) job skips the quote/approval
      // conversation entirely - SelfSourcedAssign lets the reseller pick a
      // technician immediately, so it lands directly in "My Jobs".
      return item.origin === 'reseller' ? 'my_jobs' : 'waiting_customer';
    case 'quoted':
      return 'waiting_customer';
    case 'approved':
      return 'my_jobs';
    case 'assigned':
    case 'in_progress':
      return 'in_progress';
    case 'resolved':
      // Finished and settled leaves the pipeline; part paid is the one
      // still worth chasing; anything else is simply done but unpaid.
      if (item.payment_status === 'paid') return 'paid';
      return item.payment_status === 'partial' ? 'awaiting_payment' : 'completed';
  }
}

// A pending order hasn't been looked at yet (same as an unclaimed request);
// a confirmed one still needs delivering; shipped is under way; delivered
// means there's nothing left to do.
function orderStageOf(order: Order): Stage {
  switch (order.status) {
    case 'pending':
      return 'requests';
    case 'confirmed':
      return 'my_jobs';
    case 'shipped':
      return 'in_progress';
    case 'delivered':
      return 'paid';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'requests';
  }
}

type JobItem = { kind: 'request'; id: string; request: ServiceRequest } | { kind: 'order'; id: string; order: Order };

type JobAction = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  primary: boolean;
  onPress: () => void;
};

type Tag = { label: string; bg: string; fg: string };

const TAGS = {
  app: { label: 'App customer', bg: '#EFF6FF', fg: '#1D4ED8' },
  own: { label: 'Your customer', bg: '#F5F3FF', fg: '#6D28D9' },
  order: { label: 'Shop order', bg: '#ECFDF5', fg: '#047857' },
  unpaid: { label: 'Unpaid', bg: '#FEF2F2', fg: '#DC2626' },
  paid: { label: 'Paid', bg: '#F0FDF4', fg: '#15803D' },
  holdRequested: { label: 'Hold requested', bg: '#FFFBEB', fg: '#92400E' },
  onHold: { label: 'On hold', bg: '#FFFBEB', fg: '#92400E' },
} satisfies Record<string, Tag>;

type JobRowData = {
  icon: ReactNode;
  title: string;
  who: string;
  place: string | null;
  when: string | null;
  tag: Tag;
  amount: number | null;
  action: JobAction;
  open: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
};

// Web table columns - shared by the header row and every job row.
const COLS = { job: 2.2, where: 1.4, type: 120, amount: 110, action: 190, manage: 64 };

function formatAmount(amount: number | null): string {
  return amount != null ? `NPR ${Number(amount).toLocaleString()}` : '';
}

function ActionButton({ action, color, height }: { action: JobAction; color: string; height: number }) {
  return (
    <Pressable
      onPress={action.onPress}
      className="flex-row items-center justify-center gap-1.5 rounded-lg"
      style={{
        height,
        paddingHorizontal: 12,
        backgroundColor: action.primary ? color : '#FFFFFF',
        borderWidth: action.primary ? 0 : 1,
        borderColor: '#D1D5DB',
      }}
    >
      <Ionicons name={action.icon} size={15} color={action.primary ? '#FFFFFF' : '#374151'} />
      <Text className={`font-semibold ${action.primary ? 'text-white' : 'text-gray-700'}`} style={{ fontSize: height >= 44 ? 14.5 : 13 }}>
        {action.label}
      </Text>
    </Pressable>
  );
}

function TagPill({ tag }: { tag: Tag }) {
  return (
    <View className="self-start rounded-full px-2 py-0.5" style={{ backgroundColor: tag.bg }}>
      <Text className="text-[11px] font-semibold" style={{ color: tag.fg }}>
        {tag.label}
      </Text>
    </View>
  );
}

function ManageButtons({ data }: { data: JobRowData }) {
  if (!data.onEdit && !data.onDelete) return null;
  return (
    <View className="flex-row gap-1">
      {data.onEdit && (
        <Pressable onPress={data.onEdit} hitSlop={6} className="h-8 w-8 items-center justify-center rounded-lg">
          <Ionicons name="create-outline" size={17} color="#6B7280" />
        </Pressable>
      )}
      {data.onDelete && (
        <Pressable
          onPress={data.onDelete}
          disabled={data.deleting}
          hitSlop={6}
          className="h-8 w-8 items-center justify-center rounded-lg disabled:opacity-40"
        >
          <Ionicons name="trash-outline" size={17} color="#DC2626" />
        </Pressable>
      )}
    </View>
  );
}

/** One job, rendered either as a table row (wide web) or a card (phone). */
function JobRowView({ data, stage, wide }: { data: JobRowData; stage: Stage; wide: boolean }) {
  // One brand blue for every job's button, whatever stage it is in.
  const color = '#2563EB';

  if (wide) {
    return (
      <View className="flex-row items-center border-t border-gray-100 px-[18px] py-3.5" style={{ gap: 16 }}>
        <Pressable onPress={data.open} className="flex-row items-center gap-3" style={{ flex: COLS.job, minWidth: 0 }}>
          {data.icon}
          <View className="flex-1" style={{ gap: 2 }}>
            <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
              {data.title}
            </Text>
            <Text className="text-[12.5px] text-gray-500" numberOfLines={1}>
              {data.who}
            </Text>
          </View>
        </Pressable>
        <View style={{ flex: COLS.where, minWidth: 0, gap: 2 }}>
          <Text className="text-[13px] text-gray-600" numberOfLines={1}>
            {data.place ?? '—'}
          </Text>
          {!!data.when && (
            <Text className="text-xs text-gray-400" numberOfLines={1}>
              {data.when}
            </Text>
          )}
        </View>
        <View style={{ width: COLS.type }}>
          <TagPill tag={data.tag} />
        </View>
        <Text className="text-right text-sm font-extrabold text-gray-900" style={{ width: COLS.amount }}>
          {formatAmount(data.amount) || '—'}
        </Text>
        <View style={{ width: COLS.action }}>
          <ActionButton action={data.action} color={color} height={38} />
        </View>
        <View style={{ width: COLS.manage, alignItems: 'flex-end' }}>
          <ManageButtons data={data} />
        </View>
      </View>
    );
  }

  const meta = [data.place, data.when].filter(Boolean).join(' · ');
  return (
    <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-3.5" style={{ gap: 12 }}>
      <Pressable onPress={data.open} className="flex-row items-start gap-3">
        {data.icon}
        <View className="flex-1" style={{ gap: 3 }}>
          <View className="flex-row items-start justify-between gap-2">
            <Text className="flex-1 text-[14.5px] font-bold leading-5 text-gray-900">{data.title}</Text>
            <ManageButtons data={data} />
          </View>
          <Text className="text-[13px] text-gray-600" numberOfLines={1}>
            {data.who}
          </Text>
          {!!meta && (
            <Text className="text-xs text-gray-400" numberOfLines={1}>
              {meta}
            </Text>
          )}
          <View className="mt-1 flex-row items-center gap-2">
            <TagPill tag={data.tag} />
            <Text className="ml-auto text-[15px] font-extrabold text-gray-900">{formatAmount(data.amount)}</Text>
          </View>
        </View>
      </Pressable>
      <ActionButton action={data.action} color={color} height={44} />
    </View>
  );
}

function RequestJobRow({ item, stage, wide }: { item: ServiceRequest; stage: Stage; wide: boolean }) {
  // A "reseller" origin request's client_id is just the reseller's own id
  // (there's no real customer profile behind it), so only look up real app
  // customers.
  const isIncoming = !item.reseller_id;
  // An unclaimed request only loads what the row shows - the customer's
  // number stays out of the app until this reseller accepts it.
  const { data: customerProfile } = useSupabaseRow(
    'profiles',
    item.origin === 'app' ? item.client_id : undefined,
    isIncoming ? 'id, full_name, avatar_url' : '*'
  );
  const { data: technicianProfile } = useSupabaseRow('profiles', item.technician_id ?? undefined);
  const updateRequest = useSupabaseUpdate('service_requests');
  const [deleting, setDeleting] = useState(false);

  const customerName = item.customer_name ?? customerProfile?.full_name ?? 'Customer';
  // An unclaimed request keeps the customer's number hidden until accepted.
  const customerPhone = isIncoming ? null : (item.customer_phone ?? customerProfile?.phone ?? null);
  const open = () => router.push(`/(reseller)/request/${item.id}`);

  const distance =
    item.location_data?.latitude != null &&
    item.location_data?.longitude != null &&
    technicianProfile?.latitude != null &&
    technicianProfile?.longitude != null
      ? distanceKm(
          { latitude: item.location_data.latitude, longitude: item.location_data.longitude },
          { latitude: technicianProfile.latitude, longitude: technicianProfile.longitude }
        )
      : null;

  let action: JobAction;
  if (isIncoming) {
    action = { label: 'View & accept', icon: 'checkmark-circle', primary: true, onPress: open };
  } else if (item.status === 'pending' && item.origin === 'app') {
    action = { label: 'Send quote', icon: 'pricetag-outline', primary: true, onPress: open };
  } else if (item.status === 'quoted') {
    action = customerPhone
      ? { label: 'Call customer', icon: 'call-outline', primary: false, onPress: () => Linking.openURL(`tel:${customerPhone}`) }
      : { label: 'View request', icon: 'eye-outline', primary: false, onPress: open };
  } else if (stage === 'my_jobs') {
    action = { label: 'Assign technician', icon: 'person-add-outline', primary: true, onPress: open };
  } else if (stage === 'in_progress' && item.hold_status === 'requested') {
    action = { label: 'Review hold request', icon: 'pause-circle-outline', primary: true, onPress: open };
  } else if (stage === 'in_progress') {
    action = { label: 'View job', icon: 'eye-outline', primary: false, onPress: open };
  } else if (stage === 'completed' || stage === 'awaiting_payment') {
    action = { label: 'Record payment', icon: 'cash-outline', primary: true, onPress: open };
  } else {
    action = { label: 'View', icon: 'eye-outline', primary: false, onPress: open };
  }

  const tag =
    stage === 'in_progress' && item.hold_status === 'requested'
      ? TAGS.holdRequested
      : stage === 'in_progress' && item.hold_status === 'on_hold'
        ? TAGS.onHold
        : stage === 'awaiting_payment' || stage === 'completed'
          ? TAGS.unpaid
          : stage === 'paid'
            ? TAGS.paid
            : item.origin === 'app'
              ? TAGS.app
              : TAGS.own;

  const place =
    stage === 'in_progress' && technicianProfile
      ? `${technicianProfile.full_name ?? 'Technician'}${distance != null ? ` · ${distance.toFixed(1)} km away` : ''}`
      : (item.location_data?.address ?? null);

  // Any job this reseller owns can be cancelled while it's still open (a
  // no-show app customer included); only their own walk-in jobs can be
  // edited - an app customer's details and approved price are theirs.
  const canCancel = !isIncoming && item.status !== 'resolved' && item.status !== 'cancelled';
  const canEdit = canCancel && item.origin === 'reseller';

  function handleDelete() {
    showAlert('Cancel this request?', "This marks it as cancelled - it can't be undone.", [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel request',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await updateRequest.mutateAsync({ id: item.id, values: { status: 'cancelled' } });
          } catch (err) {
            showAlert('Could not cancel', getErrorMessage(err));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  return (
    <JobRowView
      stage={stage}
      wide={wide}
      data={{
        icon: <CategoryBadge category={item.issue_type} size={wide ? 40 : 44} />,
        title: item.issue_type,
        who: customerName,
        place,
        when: formatScheduledWhen(item.scheduled_date, item.scheduled_time),
        tag,
        amount: item.quoted_price,
        action,
        open,
        onEdit: canEdit ? () => router.push(`/(reseller)/edit-request?id=${item.id}`) : undefined,
        onDelete: canCancel ? handleDelete : undefined,
        deleting,
      }}
    />
  );
}

function OrderJobRow({
  order,
  stage,
  wide,
  productMap,
}: {
  order: Order;
  stage: Stage;
  wide: boolean;
  productMap: Map<string, Product>;
}) {
  const { data: buyer } = useSupabaseRow('profiles', order.buyer_id);
  const { data: orderItems } = useSupabaseQuery('order_items', { filters: { order_id: order.id } });
  const open = () => router.push(`/(reseller)/order/${order.id}`);

  const first = orderItems?.[0];
  const firstName = first ? `${productMap.get(first.product_id)?.name ?? 'Product'} × ${first.quantity}` : `Order #${order.id.slice(0, 8)}`;
  const title = orderItems && orderItems.length > 1 ? `${firstName} + ${orderItems.length - 1} more` : firstName;

  const shipping = order.shipping_address as { address?: string; city?: string } | null;
  const place = shipping ? [shipping.address, shipping.city].filter(Boolean).join(', ') || null : null;

  // Confirming / delivering still happens on the order page itself - the
  // button just names what's waiting there.
  const nextLabel = STATUS_ACTION_LABEL[order.status];
  const action: JobAction = nextLabel
    ? { label: nextLabel, icon: 'checkmark-circle', primary: true, onPress: open }
    : { label: 'View order', icon: 'eye-outline', primary: false, onPress: open };

  return (
    <JobRowView
      stage={stage}
      wide={wide}
      data={{
        icon: (
          <View
            className="items-center justify-center bg-emerald-500"
            style={{ width: wide ? 40 : 44, height: wide ? 40 : 44, borderRadius: 12 }}
          >
            <Ionicons name="gift" size={wide ? 18 : 20} color="white" />
          </View>
        ),
        title,
        who: buyer?.full_name ?? '…',
        place,
        when: null,
        tag: TAGS.order,
        amount: order.total_amount,
        action,
        open,
      }}
    />
  );
}

export default function ResellerRequestQueue() {
  const userId = useAuthStore((state) => state.session?.user.id);
  // Once the reseller taps a pill, it stays picked - including across a
  // trip into a job's detail page and back, or switching tabs and
  // returning. jobStage only ever falls back to the smart "most needs
  // attention" default (below) while it's still null, i.e. before the
  // reseller has chosen anything themselves this session.
  const [jobStage, setJobStage] = useState<Stage | null>(null);

  // A phone browser hitting the website is still "web" (Platform.OS ===
  // 'web'), but the pipeline + table layout only makes sense once the
  // viewport is wide enough - same breakpoint as the sidebar shell.
  const { width: screenWidth } = useWindowDimensions();
  const isWideWeb = Platform.OS === 'web' && screenWidth >= WEB_SIDEBAR_MIN_WIDTH;
  const [source, setSource] = useState<Source>('customers');

  // Switching side starts again at whichever stage needs attention there.
  useEffect(() => {
    setJobStage(null);
  }, [source]);

  const { data: incomingRaw, isLoading: loadingIncoming } = useSupabaseQuery('service_requests', {
    filters: { status: 'pending', origin: 'app' },
    orderBy: { column: 'created_at', ascending: true },
  });
  // Any reseller can see a pending app request until someone claims it -
  // once reseller_id is stamped, it drops out of everyone else's pool.
  const incoming = useMemo(() => (incomingRaw ?? []).filter((r) => !r.reseller_id), [incomingRaw]);

  const { data: mine, isLoading: loadingMine } = useSupabaseQuery('service_requests', {
    filters: userId ? { reseller_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!userId,
  });

  // Product orders from customers follow the same stage pipeline as a
  // service job (Shop has no separate Orders tab).
  const { data: sellingOrders } = useSupabaseQuery('orders', {
    filters: userId ? { seller_id: userId } : {},
    orderBy: { column: 'created_at', ascending: true },
    enabled: !!userId,
  });
  const { data: allProducts } = useSupabaseQuery('products', {});
  const productMap = useMemo(() => new Map((allProducts ?? []).map((p) => [p.id, p])), [allProducts]);

  // This is the front door of the whole customer -> reseller handoff: a new
  // app request (or one the customer just approved a quote on) needs to
  // show up here without the reseller having to background/foreground the
  // app or bounce off the tab first. Three separate subscriptions, one per
  // slice this screen actually reads, rather than one unfiltered listener
  // on the whole (large, multi-tenant) table.
  const queryClient = useQueryClient();
  useEffect(() => {
    const unsubIncoming = subscribeToTable(
      'service_requests',
      () => queryClient.invalidateQueries({ queryKey: ['service_requests'] }),
      'status=eq.pending'
    );
    const unsubMine = userId
      ? subscribeToTable(
          'service_requests',
          () => queryClient.invalidateQueries({ queryKey: ['service_requests'] }),
          `reseller_id=eq.${userId}`
        )
      : undefined;
    const unsubOrders = userId
      ? subscribeToTable(
          'orders',
          () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
          `seller_id=eq.${userId}`
        )
      : undefined;
    return () => {
      unsubIncoming();
      unsubMine?.();
      unsubOrders?.();
    };
  }, [userId]);

  const isLoading = loadingIncoming || loadingMine;

  // A job the customer raised keeps origin 'app'; one the reseller raised
  // for a customer of their own is 'reseller'. Product orders are always
  // something a customer placed.
  const byStageFor = useMemo(() => {
    const build = (which: Source) => {
      const groups = new Map<Stage, JobItem[]>();
      STAGE_ORDER.forEach((stage) => groups.set(stage, []));
      if (which === 'customers') {
        incoming.forEach((item) => groups.get('requests')!.push({ kind: 'request', id: item.id, request: item }));
        (mine ?? [])
          .filter((item) => item.origin !== 'reseller')
          .forEach((item) => groups.get(stageOf(item))!.push({ kind: 'request', id: item.id, request: item }));
        (sellingOrders ?? []).forEach((order) =>
          groups.get(orderStageOf(order))!.push({ kind: 'order', id: order.id, order })
        );
      } else {
        (mine ?? [])
          .filter((item) => item.origin === 'reseller')
          .forEach((item) => groups.get(stageOf(item))!.push({ kind: 'request', id: item.id, request: item }));
      }
      return groups;
    };
    return { customers: build('customers'), mine: build('mine') };
  }, [incoming, mine, sellingOrders]);

  const myByStage = byStageFor[source];
  const sourceCounts: Record<Source, number> = {
    customers: STAGE_ORDER.filter((s) => s !== 'paid' && s !== 'cancelled').reduce(
      (sum, stage) => sum + (byStageFor.customers.get(stage)?.length ?? 0),
      0
    ),
    mine: STAGE_ORDER.filter((s) => s !== 'paid' && s !== 'cancelled').reduce(
      (sum, stage) => sum + (byStageFor.mine.get(stage)?.length ?? 0),
      0
    ),
  };

  const countOf = (stage: Stage) => myByStage.get(stage)?.length ?? 0;
  const activeStage = jobStage ?? STAGE_ORDER.find((stage) => countOf(stage) > 0) ?? 'requests';
  const stageJobs = myByStage.get(activeStage) ?? [];
  const activeMeta = STAGE_META[activeStage];

  // Keep the phone's pill strip and the list below it in sync: whichever
  // stage becomes active, scroll its pill into view at the same time.
  const chipScrollRef = useRef<ScrollView>(null);
  const chipLayouts = useRef<Partial<Record<Stage, { x: number; width: number }>>>({});

  useEffect(() => {
    const layout = chipLayouts.current[activeStage];
    if (layout) {
      chipScrollRef.current?.scrollTo({ x: Math.max(0, layout.x - 24), animated: true });
    }
  }, [activeStage]);

  const jobRow = (item: JobItem) =>
    item.kind === 'request' ? (
      <RequestJobRow key={`r-${item.id}`} item={item.request} stage={activeStage} wide={isWideWeb} />
    ) : (
      <OrderJobRow key={`o-${item.id}`} order={item.order} stage={activeStage} wide={isWideWeb} productMap={productMap} />
    );

  const emptyText = isLoading ? 'Loading…' : 'Nothing here right now.';

  if (isWideWeb) {
    const sidePill = (stage: Stage) => {
      const meta = STAGE_META[stage];
      const active = activeStage === stage;
      return (
        <Pressable
          key={stage}
          onPress={() => setJobStage(stage)}
          className="flex-row items-center gap-1.5 rounded-full bg-white px-3"
          style={{ height: 34, borderWidth: active ? 2 : 1, borderColor: active ? meta.color : '#E5E7EB' }}
        >
          <Ionicons name={meta.icon} size={14} color={meta.color} />
          <Text className="text-[12.5px] font-semibold" style={{ color: stage === 'cancelled' ? '#6B7280' : meta.color }}>
            {meta.label} ({countOf(stage)})
          </Text>
        </Pressable>
      );
    };

    return (
      <ScrollView className="flex-1 bg-gray-50" contentContainerStyle={{ padding: 32, paddingTop: 20, gap: 16 }}>
        <View className="flex-row items-center" style={{ gap: 16 }}>
          <View style={{ flex: 1, maxWidth: 460 }}>
            <SourceTabs value={source} onChange={setSource} counts={sourceCounts} />
          </View>
          <Text className="flex-1 text-[12.5px] text-gray-500">{SOURCE_META[source].blurb}</Text>
        </View>

        {source === 'mine' && (
          <Pressable
            onPress={() => router.push('/(reseller)/new-request?from=requests')}
            className="flex-row items-center gap-3 rounded-2xl p-4"
            style={{ backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' }}
          >
            <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: '#2563EB' }}>
              <Ionicons name="add" size={22} color="#FFFFFF" />
            </View>
            <View className="flex-1">
              <Text className="text-[15px] font-bold text-gray-900">Request a technician</Text>
              <Text className="mt-0.5 text-xs text-gray-600">
                Raise a job for one of your own customers, then assign it or open it to your team.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#2563EB" />
          </Pressable>
        )}

        <View className="flex-row items-stretch" style={{ gap: 6 }}>
          {WORKING_STAGES.map((stage, index) => {
            const meta = STAGE_META[stage];
            const active = activeStage === stage;
            return (
              <View key={stage} className="flex-1 flex-row items-stretch" style={{ gap: 6 }}>
                <Pressable
                  onPress={() => setJobStage(stage)}
                  className="flex-1 flex-row items-center gap-2 rounded-xl bg-white px-3 py-3"
                  style={{ borderWidth: active ? 2 : 1, borderColor: active ? meta.color : '#E5E7EB' }}
                >
                  <View className="h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: meta.color }}>
                    <Text className="text-[13px] font-extrabold text-white">{countOf(stage)}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-[13px] font-bold leading-4 text-gray-900" numberOfLines={2}>
                      {meta.label}
                    </Text>
                    <Text className="mt-0.5 text-[11.5px] leading-4 text-gray-500" numberOfLines={2}>
                      {meta.todo}
                    </Text>
                  </View>
                </Pressable>
                {index < WORKING_STAGES.length - 1 && (
                  <View className="justify-center">
                    <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <View className="flex-row items-center justify-between">
          <View className="flex-row" style={{ gap: 8 }}>
            {sidePill('paid')}
            {sidePill('cancelled')}
          </View>
          <Pressable
            onPress={() => router.push('/(reseller)/new-request?from=requests')}
            className="flex-row items-center gap-1.5 rounded-lg bg-orange-500 px-4"
            style={{ height: 38 }}
          >
            <Ionicons name="add" size={18} color="white" />
            <Text className="text-sm font-semibold text-white">New request</Text>
          </Pressable>
        </View>

        <View className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <View className="flex-row items-center gap-2.5 px-[18px] py-3.5" style={{ backgroundColor: activeMeta.tint }}>
            <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activeMeta.color }} />
            <Text className="text-[15px] font-bold text-gray-900">{activeMeta.label}</Text>
            <Text className="text-[13px] text-gray-500">— {activeMeta.todo}</Text>
          </View>
          <View className="flex-row px-[18px] py-2" style={{ gap: 16 }}>
            {(
              [
                ['Job', { flex: COLS.job }],
                ['Where / when', { flex: COLS.where }],
                ['Type', { width: COLS.type }],
                ['Amount', { width: COLS.amount, textAlign: 'right' }],
                ['Next step', { width: COLS.action, textAlign: 'center' }],
                ['', { width: COLS.manage }],
              ] as const
            ).map(([label, style]) => (
              <Text key={label || 'manage'} className="text-[11px] font-bold uppercase tracking-wide text-gray-400" style={style}>
                {label}
              </Text>
            ))}
          </View>
          {stageJobs.length === 0 ? (
            <Text className="border-t border-gray-100 px-[18px] py-6 text-sm text-gray-500">{emptyText}</Text>
          ) : (
            stageJobs.map(jobRow)
          )}
        </View>
      </ScrollView>
    );
  }

  return (
    <View className="flex-1 bg-gray-50 pt-3.5">
      <View className="mb-3 px-4">
        <SourceTabs value={source} onChange={setSource} counts={sourceCounts} />
      </View>

      {source === 'mine' && (
        <Pressable
          onPress={() => router.push('/(reseller)/new-request?from=requests')}
          className="mx-4 mb-3 flex-row items-center gap-3 rounded-2xl p-3.5"
          style={{ backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' }}
        >
          <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: '#2563EB' }}>
            <Ionicons name="add" size={20} color="#FFFFFF" />
          </View>
          <View className="flex-1">
            <Text className="text-[14.5px] font-bold text-gray-900">Request a technician</Text>
            <Text className="mt-0.5 text-[11.5px] text-gray-600">Raise a job for your own customer</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#2563EB" />
        </Pressable>
      )}

      <ScrollView
        ref={chipScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{ alignItems: 'center', gap: 8, paddingHorizontal: 16 }}
      >
        {STAGE_ORDER.map((stage) => {
          const meta = STAGE_META[stage];
          const active = activeStage === stage;
          return (
            <Pressable
              key={stage}
              onPress={() => setJobStage(stage)}
              onLayout={(e) => {
                chipLayouts.current[stage] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
              }}
              className="flex-row items-center gap-2 rounded-full py-2 pl-2 pr-3"
              style={{
                backgroundColor: active ? meta.color : '#FFFFFF',
                borderWidth: active ? 0 : 1,
                borderColor: '#E5E7EB',
              }}
            >
              <View
                className="h-6 items-center justify-center rounded-full px-1.5"
                style={{ minWidth: 24, backgroundColor: active ? 'rgba(255,255,255,0.25)' : meta.color }}
              >
                <Text className="text-xs font-extrabold text-white">{countOf(stage)}</Text>
              </View>
              <Text className={`text-[13px] font-bold ${active ? 'text-white' : 'text-gray-700'}`}>{meta.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View className="mx-4 mb-3 mt-2.5 flex-row items-center gap-2.5 rounded-xl px-3 py-2.5" style={{ backgroundColor: activeMeta.tint }}>
        <View className="h-2 w-2 rounded-full" style={{ backgroundColor: activeMeta.color }} />
        <Text className="text-[13px] text-gray-700">
          <Text className="font-bold text-gray-900">Next step: </Text>
          {activeMeta.todo.toLowerCase()}
        </Text>
      </View>

      <FlatList
        data={stageJobs}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        renderItem={({ item }) => jobRow(item)}
        ListEmptyComponent={<Text className="text-gray-500">{emptyText}</Text>}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 90 }}
      />

      <Pressable
        onPress={() => router.push('/(reseller)/new-request?from=requests')}
        className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-orange-500 shadow-lg"
        style={{ elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}
      >
        <Ionicons name="add" size={28} color="white" />
      </Pressable>
    </View>
  );
}
