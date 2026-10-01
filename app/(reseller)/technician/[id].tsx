// app/(reseller)/technician/[id].tsx
import { View, Text, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../../../lib/hooks/useAuth';
import { useSupabaseRow } from '../../../lib/hooks/useSupabase';
import { useTeamJobs } from '../../../lib/hooks/useTeamActivity';
import { TeamJobRow } from '../../../lib/components/TeamActivity';

function initialsOf(name: string | null | undefined) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export default function TechnicianWorkHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useAuthStore((state) => state.session?.user.id);

  const { data: technician, isLoading: loadingTech } = useSupabaseRow('profiles', id);
  const { data: jobs, isLoading: loadingHistory } = useTeamJobs(userId, id ? [id] : []);

  if (loadingTech || !technician) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <Text className="text-gray-500">Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
      <View className="mb-5 flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-teal-600">
          <Text className="text-base font-bold text-white">{initialsOf(technician.full_name)}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-lg font-bold text-gray-900">{technician.full_name ?? 'Technician'}</Text>
          <Text className="mt-0.5 text-sm text-gray-500">{technician.city ?? 'Nepal'}</Text>
          {technician.phone && <Text className="mt-0.5 text-sm text-gray-500">{technician.phone}</Text>}
        </View>
      </View>

      <Text className="mb-3 text-[15px] font-bold text-gray-900">Work history</Text>

      {loadingHistory && <Text className="text-gray-500">Loading…</Text>}
      {!loadingHistory && jobs.length === 0 && <Text className="text-gray-500">No jobs with this technician yet.</Text>}

      {jobs.length > 0 && (
        <View className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {jobs.map((job) => (
            <TeamJobRow key={job.request.id} job={job} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
