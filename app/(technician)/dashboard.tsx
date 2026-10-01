// app/(technician)/dashboard.tsx
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { useSupabaseQuery, useSupabaseRow } from '../../lib/hooks/useSupabase';
import { useMyEmployment } from '../../lib/hooks/useTechnicianEmployment';
import { STATUS_STYLES } from '../../lib/constants/requestStatus';
import { PersonAvatar } from '../../lib/components/PersonAvatar';
import { RequestPhotoThumb } from '../../lib/components/RequestPhotoThumb';
import { CategoryBadge } from '../../lib/components/CategoryBadge';
import { respondToJobOffer, useOpenTeamJobs, claimOpenJob } from '../../lib/hooks/useJobOffers';
import { showAlert, getErrorMessage } from '../../lib/utils/alert';
import { formatScheduledWhen } from '../../lib/utils/scheduledTime';
import type { ServiceRequest } from '../../types/database.types';

function StatusPill({ status }: { status: ServiceRequest['status'] }) {
  const style = STATUS_STYLES[status];
  return (
    <View className={`rounded-full px-2 py-0.5 ${style.bg}`}>
      <Text className={`text-[10px] font-semibold uppercase ${style.text}`}>{style.label}</Text>
    </View>
  );
}

function WorkDetails({ item }: { item: ServiceRequest }) {
  return (
    <View className="flex-1">
      <View className="flex-row items-start justify-between gap-2">
        <Text className="flex-1 font-semibold text-gray-900">{item.issue_type}</Text>
        <StatusPill status={item.status} />
      </View>
      {item.description && (
        <Text className="mt-1 text-sm text-gray-600" numberOfLines={2}>
          {item.description}
        </Text>
      )}
      <View className="mt-2 gap-1">
        {(item.scheduled_date || item.scheduled_time) && (
          <Text className="text-xs text-gray-500">
            <Ionicons name="calendar-outline" size={11} color="#9CA3AF" /> Scheduled {formatScheduledWhen(item.scheduled_date, item.scheduled_time)}
          </Text>
        )}
        {item.location_data?.address && (
          <Text className="text-xs text-gray-500" numberOfLines={1}>
            <Ionicons name="location-outline" size={11} color="#9CA3AF" /> {item.location_data.address}
          </Text>
        )}
        {item.quoted_price != null && (
          <Text className="text-xs text-gray-500">
            <Ionicons name="cash-outline" size={11} color="#9CA3AF" /> NPR {Number(item.quoted_price).toLocaleString()}
          </Text>
        )}
      </View>
    </View>
  );
}

function NewJobCard({ item }: { item: ServiceRequest }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function answer(accept: boolean) {
    setBusy(true);
    try {
      await respondToJobOffer(item.id, accept);
      await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
      if (accept) router.push(`/(technician)/job/${item.id}`);
    } catch (err) {
      showAlert(accept ? 'Could not accept' : 'Could not reject', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function onAnswer(accept: boolean) {
    if (accept) {
      answer(true);
      return;
    }
    showAlert('Reject this job?', 'It goes back to the reseller so they can offer it to someone else.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Reject', style: 'destructive', onPress: () => answer(false) },
    ]);
  }

  return (
    <View className="mb-3 rounded-2xl border border-orange-100 bg-white p-4">
      <Pressable onPress={() => router.push(`/(technician)/job/${item.id}`)} className="flex-row items-start gap-3">
        <View className="items-center gap-1.5">
          <CategoryBadge category={item.issue_type} />
          <RequestPhotoThumb photoUrls={item.photo_urls} size={44} />
        </View>
        <WorkDetails item={item} />
      </Pressable>

      <View className="mt-3 flex-row" style={{ gap: 8 }}>
        <Pressable
          onPress={() => onAnswer(false)}
          disabled={busy}
          className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl py-2.5 disabled:opacity-60"
          style={{ backgroundColor: '#DC2626' }}
        >
          <Ionicons name="close" size={17} color="white" />
          <Text className="text-sm font-semibold text-white">Reject</Text>
        </Pressable>
        <Pressable
          onPress={() => onAnswer(true)}
          disabled={busy}
          className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl py-2.5 disabled:opacity-60"
          style={{ backgroundColor: '#16A34A' }}
        >
          <Ionicons name="checkmark" size={17} color="white" />
          <Text className="text-sm font-semibold text-white">Accept</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ContactRow({
  label,
  name,
  phone,
  bg,
}: {
  label: string;
  name: string | null | undefined;
  phone: string | null | undefined;
  bg: string;
}) {
  if (!name && !phone) return null;
  return (
    <View className="flex-row items-center gap-2">
      <PersonAvatar name={name} size={28} bg={bg} />
      <View>
        <Text className="text-[9.5px] font-semibold uppercase tracking-wide text-gray-400">{label}</Text>
        <Text className="text-xs font-semibold text-gray-700" numberOfLines={1}>
          {name ?? 'Unnamed'}
          {phone ? ` · ${phone}` : ''}
        </Text>
      </View>
    </View>
  );
}

function ActiveJobCard({ item }: { item: ServiceRequest }) {
  const needsCustomerLookup = !item.customer_name;
  const { data: customer } = useSupabaseRow('profiles', needsCustomerLookup ? item.client_id : undefined);
  const { data: reseller } = useSupabaseRow('profiles', item.reseller_id ?? undefined);

  const customerName = item.customer_name ?? customer?.full_name;
  const customerPhone = item.customer_phone ?? customer?.phone;

  return (
    <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
      <Pressable onPress={() => router.push(`/(technician)/job/${item.id}`)} className="flex-row items-start gap-3">
        <View className="items-center gap-1.5">
          <CategoryBadge category={item.issue_type} />
          <RequestPhotoThumb photoUrls={item.photo_urls} size={44} />
        </View>
        <WorkDetails item={item} />
      </Pressable>

      {(reseller || customerName || customerPhone) && (
        <View className="mt-3 flex-row flex-wrap gap-4 border-t border-gray-100 pt-3">
          <ContactRow label="Reseller" name={reseller?.full_name} phone={reseller?.phone} bg="bg-orange-500" />
          <ContactRow label="Customer" name={customerName} phone={customerPhone} bg="bg-teal-600" />
        </View>
      )}

      <Pressable
        onPress={() => router.push(`/(technician)/job/${item.id}`)}
        className="mt-3 flex-row items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5"
      >
        <Text className="text-sm font-semibold text-white">View Job</Text>
        <Ionicons name="arrow-forward-circle" size={16} color="white" />
      </Pressable>
    </View>
  );
}

/** Work the employer put in front of the whole team. Nobody owns it yet,
 * so the only action is to take it - and whoever taps first gets it (the
 * server settles ties, see claim_open_job). */
function OpenJobCard({ item }: { item: ServiceRequest }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function take() {
    setBusy(true);
    try {
      await claimOpenJob(item.id);
      await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
      await queryClient.invalidateQueries({ queryKey: ['job_cards'] });
      router.push(`/(technician)/job/${item.id}`);
    } catch (err) {
      const message = getErrorMessage(err);
      showAlert(
        message.includes('already taken') ? 'Too late' : 'Could not take this job',
        message.includes('already taken') ? 'A teammate got to this one first.' : message
      );
      await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="mb-3 rounded-2xl border p-4" style={{ borderColor: '#A7F3D0', backgroundColor: '#F0FDF4' }}>
      <Pressable onPress={() => router.push(`/(technician)/job/${item.id}`)} className="flex-row items-start gap-3">
        <View className="items-center gap-1.5">
          <CategoryBadge category={item.issue_type} />
          <RequestPhotoThumb photoUrls={item.photo_urls} size={44} />
        </View>
        <WorkDetails item={item} />
      </Pressable>

      <View className="mt-3 flex-row items-center gap-1.5">
        <Ionicons name="people-outline" size={13} color="#047857" />
        <Text className="flex-1 text-[11.5px] text-emerald-800">
          Open to the whole team - first to take it gets it.
        </Text>
      </View>

      <Pressable
        onPress={take}
        disabled={busy}
        className="mt-3 flex-row items-center justify-center gap-1.5 rounded-xl py-2.5 disabled:opacity-60"
        style={{ backgroundColor: '#16A34A' }}
      >
        <Ionicons name="hand-left-outline" size={16} color="white" />
        <Text className="text-sm font-bold text-white">{busy ? 'Taking…' : 'Take this job'}</Text>
      </Pressable>
    </View>
  );
}

function EmploymentStatusCard({ userId }: { userId: string }) {
  const { current, employer } = useMyEmployment(userId);

  const label =
    current?.status === 'accepted' && current.leave_requested_at
      ? `Leave requested · waiting on ${employer?.full_name ?? 'your employer'}`
      : current?.status === 'accepted'
      ? `Employee of ${employer?.full_name ?? 'a reseller'}`
      : current?.status === 'pending'
        ? `Waiting on ${employer?.full_name ?? 'a reseller'}`
        : 'Not employed by a reseller';
  const icon = current?.status === 'accepted' ? 'briefcase' : current?.status === 'pending' ? 'time-outline' : 'person-add-outline';

  return (
    <Pressable
      onPress={() => router.push('/(technician)/employment')}
      className="mb-4 flex-row items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3"
    >
      <View className="flex-1 flex-row items-center gap-2.5">
        <Ionicons name={icon} size={18} color="#3b82f6" />
        <Text className="flex-1 text-sm font-semibold text-gray-800" numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
    </Pressable>
  );
}

export default function TechnicianDashboard() {
  const profile = useAuthStore((state) => state.profile);
  const userId = useAuthStore((state) => state.session?.user.id);

  const { data: jobs } = useSupabaseQuery('service_requests', {
    filters: userId ? { technician_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!userId,
  });
  const { data: reviews } = useSupabaseQuery('reviews', {
    filters: userId ? { technician_id: userId } : {},
    enabled: !!userId,
  });

  const newJobs = useMemo(() => (jobs ?? []).filter((j) => j.status === 'assigned'), [jobs]);
  const openJobs = useOpenTeamJobs(userId);
  const activeJobs = useMemo(() => (jobs ?? []).filter((j) => j.status === 'in_progress'), [jobs]);
  const averageRating = useMemo(() => {
    if (!reviews || reviews.length === 0) return null;
    return reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  }, [reviews]);

  const totalActive = newJobs.length + activeJobs.length;

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
      <Text className="mb-1 text-2xl font-bold text-gray-900">
        Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}
      </Text>
      <Text className="mb-5 text-gray-500">
        {totalActive} active job{totalActive === 1 ? '' : 's'} right now
        {averageRating != null && ` · ★ ${averageRating.toFixed(1)}`}
      </Text>

      {userId && <EmploymentStatusCard userId={userId} />}

      {openJobs.length > 0 && (
        <>
          <View className="mb-2.5 flex-row items-center gap-1.5">
            <Ionicons name="people" size={15} color="#059669" />
            <Text className="text-[15px] font-bold text-gray-900">
              Open work from your employer ({openJobs.length})
            </Text>
          </View>
          {openJobs.map((job) => (
            <OpenJobCard key={job.id} item={job} />
          ))}
        </>
      )}

      {totalActive === 0 && openJobs.length === 0 && (
        <View className="items-center rounded-2xl border border-dashed border-gray-200 bg-white py-10">
          <Ionicons name="briefcase-outline" size={28} color="#D1D5DB" />
          <Text className="mt-2 text-gray-500">No jobs assigned yet.</Text>
          <Text className="text-xs text-gray-400">New assignments will show up here.</Text>
        </View>
      )}

      {newJobs.length > 0 && (
        <>
          <View className="mb-2.5 flex-row items-center gap-1.5">
            <Ionicons name="alert-circle" size={15} color="#3b82f6" />
            <Text className="text-[15px] font-bold text-gray-900">New assignment{newJobs.length === 1 ? '' : 's'}</Text>
          </View>
          {newJobs.map((job) => (
            <NewJobCard key={job.id} item={job} />
          ))}
        </>
      )}

      {activeJobs.length > 0 && (
        <>
          <View className="mb-2.5 mt-1 flex-row items-center gap-1.5">
            <Ionicons name="build" size={15} color="#2563EB" />
            <Text className="text-[15px] font-bold text-gray-900">In progress</Text>
          </View>
          {activeJobs.map((job) => (
            <ActiveJobCard key={job.id} item={job} />
          ))}
        </>
      )}
    </ScrollView>
  );
}
