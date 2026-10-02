// app/(technician)/jobs.tsx
import { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { useSupabaseQuery, useSupabaseRow } from '../../lib/hooks/useSupabase';
import { STATUS_STYLES } from '../../lib/constants/requestStatus';
import { RequestPhotoThumb } from '../../lib/components/RequestPhotoThumb';
import { CategoryBadge } from '../../lib/components/CategoryBadge';
import { formatDuration, formatTimestamp } from '../../lib/utils/duration';
import { formatScheduledWhen } from '../../lib/utils/scheduledTime';
import type { ServiceRequest } from '../../types/database.types';

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

function JobElapsedBadge({ requestId, status }: { requestId: string; status: ServiceRequest['status'] }) {
  const { data: jobCards } = useSupabaseQuery('job_cards', {
    filters: { service_request_id: requestId },
  });
  const jobCard = jobCards?.[0];
  const now = useNow(status === 'in_progress' && !!jobCard?.started_at);

  // A job_cards row created via the "no job card was opened (older data)"
  // fallback in job/[id].tsx's handleAdvance has completed_at but no
  // started_at - requiring both here used to hide the whole badge (and the
  // Completed tab's "Completed at" line with it) for those jobs. Each field
  // is now shown only if it's actually there.
  if (!jobCard || (!jobCard.started_at && !jobCard.completed_at)) return null;

  if (status === 'in_progress' && jobCard.started_at) {
    return (
      <View className="mt-1.5 rounded-lg bg-blue-50 px-2 py-1.5">
        <Text className="text-[10px] text-blue-900">
          <Text className="font-semibold">Accepted at: </Text>
          {formatTimestamp(jobCard.started_at)}
        </Text>
        <Text className="mt-0.5 text-[10px] font-bold text-blue-700">
          Time elapsed: {formatDuration(now - new Date(jobCard.started_at).getTime())}
        </Text>
      </View>
    );
  }

  if (status === 'resolved' && jobCard.completed_at) {
    return (
      <View className="mt-1.5 rounded-lg bg-gray-100 px-2 py-1.5">
        {jobCard.started_at && (
          <Text className="text-[10px] text-gray-700">
            <Text className="font-semibold">Accepted at: </Text>
            {formatTimestamp(jobCard.started_at)}
          </Text>
        )}
        <Text className="mt-0.5 text-[10px] text-gray-700">
          <Text className="font-semibold">Completed at: </Text>
          {formatTimestamp(jobCard.completed_at)}
        </Text>
        {jobCard.started_at && (
          <Text className="mt-0.5 text-[10px] font-bold text-gray-800">
            Time elapsed: {formatDuration(new Date(jobCard.completed_at).getTime() - new Date(jobCard.started_at).getTime())}
          </Text>
        )}
      </View>
    );
  }

  return null;
}

function StatusPill({ status }: { status: ServiceRequest['status'] }) {
  const style = STATUS_STYLES[status];
  return (
    <View className={`rounded-full px-2 py-0.5 ${style.bg}`}>
      <Text className={`text-[10px] font-semibold uppercase ${style.text}`}>{style.label}</Text>
    </View>
  );
}

function HoldPill({ holdStatus }: { holdStatus: ServiceRequest['hold_status'] }) {
  if (holdStatus === 'none') return null;
  return (
    <View className="mt-1.5 flex-row items-center gap-1 self-start rounded-full bg-amber-50 px-2 py-0.5">
      <Ionicons name="pause-circle" size={11} color="#92400E" />
      <Text className="text-[10px] font-semibold text-amber-800">
        {holdStatus === 'requested' ? 'Hold requested' : 'On hold'}
      </Text>
    </View>
  );
}

function JobListCard({ item }: { item: ServiceRequest }) {
  const needsCustomerLookup = !item.customer_name;
  const { data: customer } = useSupabaseRow('profiles', needsCustomerLookup ? item.client_id : undefined);
  const customerName = item.customer_name ?? customer?.full_name;
  const customerPhone = item.customer_phone ?? customer?.phone;

  return (
    <Pressable
      onPress={() => router.push(`/(technician)/job/${item.id}`)}
      className="mb-3 flex-row items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4"
    >
      <View className="items-center gap-1.5">
        <CategoryBadge category={item.issue_type} />
        <RequestPhotoThumb photoUrls={item.photo_urls} size={44} />
      </View>
      <View className="flex-1">
      <View className="flex-row items-start justify-between gap-2">
        <Text className="flex-1 font-semibold text-gray-900">{item.issue_type}</Text>
        <StatusPill status={item.status} />
      </View>
      <JobElapsedBadge requestId={item.id} status={item.status} />
      <HoldPill holdStatus={item.hold_status} />
      {item.description && (
        <Text className="mt-1 text-sm text-gray-600" numberOfLines={2}>
          {item.description}
        </Text>
      )}

      <View className="mt-3 gap-1">
        {(customerName || customerPhone) && (
          <Text className="text-xs text-gray-500">
            <Text className="font-medium text-gray-600">Customer: </Text>
            {customerName ?? 'Unknown'}
            {customerPhone ? ` · ${customerPhone}` : ''}
          </Text>
        )}
        {(item.scheduled_date || item.scheduled_time) && (
          <Text className="text-xs text-gray-500">
            <Text className="font-medium text-gray-600">Scheduled visit: </Text>
            {formatScheduledWhen(item.scheduled_date, item.scheduled_time)}
          </Text>
        )}
        {item.location_data?.address && (
          <Text className="text-xs text-gray-500" numberOfLines={1}>
            <Text className="font-medium text-gray-600">Address: </Text>
            {item.location_data.address}
          </Text>
        )}
        {item.quoted_price != null && (
          <Text className="text-xs text-gray-500">
            <Text className="font-medium text-gray-600">Price: </Text>
            NPR {Number(item.quoted_price).toLocaleString()}
          </Text>
        )}
        {item.remark && (
          <Text className="mt-1 text-xs italic text-gray-400" numberOfLines={2}>
            "{item.remark}"
          </Text>
        )}
      </View>
      </View>
    </Pressable>
  );
}

type JobsTab = 'in_progress' | 'resolved';

function TabPill({ label, count, active, onPress }: { label: string; count: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 flex-row items-center justify-center gap-1.5 rounded-full py-2"
      style={{ backgroundColor: active ? '#2563EB' : '#FFFFFF', borderWidth: active ? 0 : 1, borderColor: '#E5E7EB' }}
    >
      <Text className={`text-[13px] font-bold ${active ? 'text-white' : 'text-gray-700'}`}>
        {label} ({count})
      </Text>
    </Pressable>
  );
}

export default function TechnicianJobs() {
  const userId = useAuthStore((state) => state.session?.user.id);
  // The dashboard's "Jobs completed" tile opens this tab on Completed. `t` is
  // a changing stamp, so the tile works again even when the tab was already
  // left on Completed and the person switched back to In progress by hand.
  const { tab: tabParam, t: tabStamp } = useLocalSearchParams<{ tab?: string; t?: string }>();
  const [tab, setTab] = useState<JobsTab>(tabParam === 'completed' ? 'resolved' : 'in_progress');
  useEffect(() => {
    if (tabParam === 'completed') setTab('resolved');
    else if (tabParam === 'in_progress') setTab('in_progress');
  }, [tabParam, tabStamp]);

  const { data: jobs, isLoading } = useSupabaseQuery('service_requests', {
    filters: userId ? { technician_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!userId,
  });

  // This tab is for work the technician has actually started or finished -
  // new offers awaiting a response live on the dashboard instead. Split
  // into two lists rather than one flat one so "what's still open" and
  // "what's done" don't get mixed together.
  const inProgressJobs = useMemo(() => (jobs ?? []).filter((j) => j.status === 'in_progress'), [jobs]);
  const completedJobs = useMemo(() => (jobs ?? []).filter((j) => j.status === 'resolved'), [jobs]);
  const activeJobs = tab === 'in_progress' ? inProgressJobs : completedJobs;

  // A reseller assigning a new job (or a job's status changing under this
  // technician, e.g. someone else updating it from the web) should land
  // here right away. useJobOffers's realtime subscription (mounted for the
  // whole technician portal via IncomingJobOffer in _layout.tsx) already
  // invalidates this same ['service_requests'] query key on every change,
  // so a second subscription here isn't needed - and would throw, since
  // Supabase reuses the already-joined channel for the same table+filter.

  return (
    <View className="flex-1 bg-gray-50 px-6 pt-4">
      <View className="mb-4 flex-row" style={{ gap: 8 }}>
        <TabPill label="In progress" count={inProgressJobs.length} active={tab === 'in_progress'} onPress={() => setTab('in_progress')} />
        <TabPill label="Completed" count={completedJobs.length} active={tab === 'resolved'} onPress={() => setTab('resolved')} />
      </View>

      {isLoading && <Text className="text-gray-500">Loading…</Text>}
      {!isLoading && activeJobs.length === 0 && (
        <Text className="text-gray-500">{tab === 'in_progress' ? 'No jobs in progress.' : 'No completed jobs yet.'}</Text>
      )}

      <FlatList data={activeJobs} keyExtractor={(item) => item.id} renderItem={({ item }) => <JobListCard item={item} />} />
    </View>
  );
}
