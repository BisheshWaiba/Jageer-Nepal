// lib/components/technician/InboxButton.tsx
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { useOpenTeamJobs } from '../../hooks/useJobOffers';

/** Opens the technician's Inbox - job offers to answer, open team work to
 * take and the employment link, which used to be the Home tab. Shows how
 * many things are waiting there. */
export function InboxButton() {
  const userId = useAuthStore((state) => state.session?.user.id);
  const { data: offers } = useSupabaseQuery('service_requests', {
    filters: userId ? { technician_id: userId, status: 'assigned' } : {},
    enabled: !!userId,
    queryOptions: { refetchInterval: 20_000 },
  });
  const open = useOpenTeamJobs(userId);
  const waiting = (offers?.length ?? 0) + open.length;

  return (
    <Pressable
      onPress={() => router.push('/(technician)/inbox')}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={waiting > 0 ? `Inbox, ${waiting} waiting` : 'Inbox'}
      className="h-9 w-9 items-center justify-center rounded-full bg-gray-100 active:bg-gray-200"
    >
      <Ionicons name="file-tray-full-outline" size={19} color="#374151" />
      {waiting > 0 && (
        <View
          className="absolute items-center justify-center rounded-full bg-blue-600"
          style={{ top: -4, right: -4, minWidth: 18, height: 18, paddingHorizontal: 4, borderWidth: 2, borderColor: '#ffffff' }}
        >
          <Text className="text-[10px] font-bold text-white">{waiting > 9 ? '9+' : waiting}</Text>
        </View>
      )}
    </Pressable>
  );
}
