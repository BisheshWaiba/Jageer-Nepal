// lib/components/HoldNotice.tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, Platform } from 'react-native';
import { router, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSupabaseQuery, subscribeToTable } from '../hooks/useSupabase';
import type { ServiceRequest } from '../../types/database.types';

type Tone = 'amber' | 'gray';

const TONES: Record<Tone, { bg: string; fg: string }> = {
  amber: { bg: '#D97706', fg: '#FFFFFF' },
  gray: { bg: '#374151', fg: '#FFFFFF' },
};

/** A small floating pill at the top of the screen that slides in over
 * whichever tab is open - tap to jump to the job, optional × to dismiss. */
function HoldCapsule({
  tone,
  icon,
  label,
  onPress,
  onDismiss,
}: {
  tone: Tone;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  onDismiss?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;
  const { bg, fg } = TONES[tone];

  useEffect(() => {
    Animated.timing(slide, { toValue: 1, duration: 260, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start();
  }, [slide]);

  return (
    <View
      pointerEvents="box-none"
      className="absolute left-0 right-0 items-center px-4"
      style={{ top: Platform.OS === 'web' ? 12 : insets.top + 8, zIndex: 900, elevation: 14 }}
    >
      <Animated.View
        style={{
          opacity: slide,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
          maxWidth: 420,
        }}
      >
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label}
          className="flex-row items-center gap-2 rounded-full py-2.5 pl-3.5"
          style={{
            paddingRight: onDismiss ? 6 : 16,
            backgroundColor: bg,
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
          }}
        >
          <Ionicons name={icon} size={18} color={fg} />
          <Text className="flex-shrink text-[13.5px] font-bold" style={{ color: fg }} numberOfLines={1}>
            {label}
          </Text>
          {onDismiss ? (
            <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel="Dismiss" className="ml-1 rounded-full p-1">
              <Ionicons name="close" size={16} color={fg} />
            </Pressable>
          ) : (
            <Ionicons name="chevron-forward" size={16} color={fg} />
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** Reseller side: stays up while any of their jobs has a technician's hold
 * request waiting on them, so it can't be missed from another tab. Hidden
 * on the job page itself, where the Hold request card already asks. */
export function ResellerHoldNotice({ resellerId }: { resellerId: string | undefined }) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { data } = useSupabaseQuery('service_requests', {
    filters: resellerId ? { reseller_id: resellerId, hold_status: 'requested', status: 'in_progress' } : {},
    orderBy: { column: 'hold_requested_at', ascending: true },
    enabled: !!resellerId,
    queryOptions: { refetchInterval: 20_000 },
  });

  useEffect(() => {
    if (!resellerId) return;
    return subscribeToTable(
      'service_requests',
      () => queryClient.invalidateQueries({ queryKey: ['service_requests'] }),
      `reseller_id=eq.${resellerId}`,
      'hold-notice'
    );
  }, [resellerId, queryClient]);

  const pending = data ?? [];
  const first = pending[0];
  if (!first || pathname === `/request/${first.id}`) return null;

  const label =
    pending.length === 1 ? `Hold requested · ${first.issue_type}` : `${pending.length} hold requests waiting`;

  return (
    <HoldCapsule
      tone="amber"
      icon="pause-circle"
      label={label}
      onPress={() => router.push(`/(reseller)/request/${first.id}` as any)}
    />
  );
}

type HoldOutcome = { id: string; issueType: string; approved: boolean };

/** Technician side: pops up the moment the reseller answers one of their
 * hold requests - approved (job is now paused) or declined (carry on).
 * Relies on IncomingJobOffer's service_requests subscription for this
 * technician to refresh the query live, so it doesn't open another one. */
export function TechnicianHoldNotice({ technicianId }: { technicianId: string | undefined }) {
  const pathname = usePathname();
  const { data } = useSupabaseQuery('service_requests', {
    filters: technicianId ? { technician_id: technicianId, status: 'in_progress' } : {},
    enabled: !!technicianId,
    queryOptions: { refetchInterval: 20_000 },
  });
  const lastSeen = useRef<Map<string, ServiceRequest['hold_status']> | null>(null);
  const [outcome, setOutcome] = useState<HoldOutcome | null>(null);

  // Only a requested -> on_hold/none change seen while the app is open counts
  // as an answer - the first load just records where things stand, so an old
  // decision doesn't pop up again on every launch.
  useEffect(() => {
    if (!data) return;
    const prev = lastSeen.current;
    const next = new Map(data.map((job) => [job.id, job.hold_status]));
    if (prev) {
      for (const job of data) {
        if (prev.get(job.id) === 'requested' && job.hold_status !== 'requested') {
          setOutcome({ id: job.id, issueType: job.issue_type, approved: job.hold_status === 'on_hold' });
        }
      }
    }
    lastSeen.current = next;
  }, [data]);

  useEffect(() => {
    if (!outcome) return;
    const hide = setTimeout(() => setOutcome(null), 10_000);
    return () => clearTimeout(hide);
  }, [outcome]);

  if (!outcome || pathname === `/job/${outcome.id}`) return null;

  return (
    <HoldCapsule
      key={outcome.id + String(outcome.approved)}
      tone={outcome.approved ? 'amber' : 'gray'}
      icon={outcome.approved ? 'pause-circle' : 'play-circle'}
      label={outcome.approved ? `Hold approved · ${outcome.issueType}` : `Hold declined · keep working on ${outcome.issueType}`}
      onPress={() => {
        setOutcome(null);
        router.push(`/(technician)/job/${outcome.id}` as any);
      }}
      onDismiss={() => setOutcome(null)}
    />
  );
}
