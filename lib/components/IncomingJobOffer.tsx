// lib/components/IncomingJobOffer.tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, Platform, Vibration, BackHandler } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useSupabaseRow } from '../hooks/useSupabase';
import { useJobOffers, respondToJobOffer } from '../hooks/useJobOffers';
import { CategoryBadge } from './CategoryBadge';
import { useWideDetail } from './detail/DetailLayout';
import { showAlert, getErrorMessage } from '../utils/alert';
import { formatScheduledWhen } from '../utils/scheduledTime';

const GREEN = '#16A34A';
const RED = '#DC2626';

/** A bell that shakes like a phone ringing, with rings pulsing out of it. */
function RingingBell({ size = 64 }: { size?: number }) {
  const shake = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const ring = Animated.loop(
      Animated.sequence([
        ...[1, -1, 1, -1, 1, -1, 0].map((to) =>
          Animated.timing(shake, { toValue: to, duration: 70, easing: Easing.linear, useNativeDriver: true })
        ),
        Animated.delay(600),
      ])
    );
    const rings = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true })
    );
    ring.start();
    rings.start();
    return () => {
      ring.stop();
      rings.stop();
    };
  }, [shake, pulse]);

  const rotate = shake.interpolate({ inputRange: [-1, 1], outputRange: ['-18deg', '18deg'] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  return (
    <View style={{ width: size * 1.9, height: size * 1.9, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size,
          backgroundColor: GREEN,
          opacity: ringOpacity,
          transform: [{ scale: ringScale }],
        }}
      />
      <View
        style={{ width: size, height: size, borderRadius: size, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' }}
      >
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name="notifications" size={size * 0.5} color="#fff" />
        </Animated.View>
      </View>
    </View>
  );
}

/** A new job offered to this technician, shown over whichever tab they are
 * on the moment it arrives, like an incoming call: ringing bell, the job at
 * a glance, a red Reject and a green Accept. "View details" tucks it into a
 * small bar at the top so they can read the job first and answer from there.
 * The close button (or Android back) puts it away without answering - the
 * offer stays under New assignments in their Inbox, and only a newer
 * offer pops up again. */
export function IncomingJobOffer({ technicianId }: { technicianId: string | undefined }) {
  const offers = useJobOffers(technicianId);
  const queryClient = useQueryClient();
  const wide = useWideDetail();
  const [minimizedId, setMinimizedId] = useState<string | null>(null);
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);

  const waiting = offers.filter((o) => !dismissedIds.has(o.id));
  const offer = waiting[0] ?? null;
  const minimized = !!offer && minimizedId === offer.id;
  const { data: reseller } = useSupabaseRow('profiles', offer?.reseller_id ?? undefined);

  // Buzz like a ringing phone while the request is on screen (native only).
  useEffect(() => {
    if (Platform.OS === 'web' || !offer || minimized) return;
    Vibration.vibrate([0, 600, 900], true);
    const stopAfter = setTimeout(() => Vibration.cancel(), 30_000);
    return () => {
      clearTimeout(stopAfter);
      Vibration.cancel();
    };
  }, [offer?.id, minimized]);

  function dismiss() {
    if (!offer) return;
    const id = offer.id;
    setDismissedIds((prev) => new Set(prev).add(id));
  }

  // Android back closes the full-screen offer like any other dialog.
  useEffect(() => {
    if (!offer || minimized) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
  }, [offer?.id, minimized]);

  if (!offer) return null;

  async function answer(accept: boolean) {
    if (!offer) return;
    setBusy(accept ? 'accept' : 'reject');
    try {
      await respondToJobOffer(offer.id, accept);
      await queryClient.invalidateQueries({ queryKey: ['service_requests'] });
      if (accept) router.push(`/(technician)/job/${offer.id}` as any);
    } catch (err) {
      showAlert(accept ? 'Could not accept' : 'Could not reject', getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function confirmReject() {
    showAlert('Reject this job?', 'It goes back to the reseller so they can offer it to someone else.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Reject', style: 'destructive', onPress: () => answer(false) },
    ]);
  }

  if (minimized) {
    return (
      <Pressable
        onPress={() => setMinimizedId(null)}
        className="absolute left-3 right-3 flex-row items-center gap-3 rounded-2xl px-4 py-3"
        style={{
          top: Platform.OS === 'web' ? 12 : 44,
          backgroundColor: GREEN,
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 12,
          ...(wide ? { left: undefined, right: 24, width: 360 } : null),
        }}
      >
        <Ionicons name="notifications" size={20} color="#fff" />
        <Text className="flex-1 text-sm font-bold text-white" numberOfLines={1}>
          {waiting.length === 1 ? 'New job request' : `${waiting.length} job requests`} · tap to answer
        </Text>
        <Ionicons name="chevron-down" size={18} color="#fff" />
        <Pressable onPress={dismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close without answering">
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
      </Pressable>
    );
  }

  const when = formatScheduledWhen(offer.scheduled_date, offer.scheduled_time);

  return (
    <View
      className="absolute inset-0"
      style={{
        backgroundColor: 'rgba(17,24,39,0.6)',
        justifyContent: wide ? 'center' : 'flex-end',
        alignItems: 'center',
        zIndex: 1000,
        elevation: 20,
      }}
    >
      <View
        className="w-full bg-white px-5 pb-6 pt-4"
        style={{
          maxWidth: wide ? 440 : undefined,
          borderRadius: wide ? 24 : 0,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
        }}
      >
        <Pressable
          onPress={dismiss}
          disabled={!!busy}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close without answering"
          className="absolute right-3 top-3 z-10 h-9 w-9 items-center justify-center rounded-full bg-gray-100"
        >
          <Ionicons name="close" size={20} color="#4B5563" />
        </Pressable>

        <View className="items-center">
          <RingingBell />
          <Text className="-mt-1 text-xl font-extrabold text-gray-900">New job request</Text>
          {waiting.length > 1 && <Text className="mt-0.5 text-xs text-gray-500">1 of {waiting.length} waiting</Text>}
        </View>

        <View className="mt-4 rounded-2xl border border-gray-200 p-3.5" style={{ gap: 10 }}>
          <View className="flex-row items-center gap-3">
            <CategoryBadge category={offer.issue_type} size={44} />
            <View className="flex-1">
              <Text className="text-[15px] font-bold text-gray-900" numberOfLines={2}>
                {offer.issue_type}
              </Text>
              {!!reseller && (
                <Text className="text-xs text-gray-500" numberOfLines={1}>
                  From {reseller.business_name || reseller.full_name}
                </Text>
              )}
            </View>
            {offer.quoted_price != null && (
              <Text className="text-base font-extrabold text-gray-900">NPR {Number(offer.quoted_price).toLocaleString()}</Text>
            )}
          </View>
          {!!when && (
            <View className="flex-row items-center gap-2">
              <Ionicons name="calendar-outline" size={15} color="#6B7280" />
              <Text className="text-[13px] text-gray-700">{when}</Text>
            </View>
          )}
          {!!offer.location_data?.address && (
            <View className="flex-row items-center gap-2">
              <Ionicons name="location-outline" size={15} color="#6B7280" />
              <Text className="flex-1 text-[13px] text-gray-700" numberOfLines={2}>
                {offer.location_data.address}
              </Text>
            </View>
          )}
          {!!offer.description && (
            <Text className="text-[13px] text-gray-500" numberOfLines={2}>
              {offer.description}
            </Text>
          )}
        </View>

        <View className="mt-5 flex-row" style={{ gap: 12 }}>
          <Pressable
            onPress={confirmReject}
            disabled={!!busy}
            accessibilityLabel="Reject job"
            className="h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl disabled:opacity-60"
            style={{ backgroundColor: RED }}
          >
            <Ionicons name="close" size={24} color="#fff" />
            <Text className="text-base font-bold text-white">{busy === 'reject' ? 'Rejecting…' : 'Reject'}</Text>
          </Pressable>
          <Pressable
            onPress={() => answer(true)}
            disabled={!!busy}
            accessibilityLabel="Accept job"
            className="h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl disabled:opacity-60"
            style={{ backgroundColor: GREEN }}
          >
            <Ionicons name="checkmark" size={24} color="#fff" />
            <Text className="text-base font-bold text-white">{busy === 'accept' ? 'Accepting…' : 'Accept'}</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => {
            setMinimizedId(offer.id);
            router.push(`/(technician)/job/${offer.id}` as any);
          }}
          className="mt-3 items-center py-2"
        >
          <Text className="text-sm font-semibold text-blue-600">View full details first</Text>
        </Pressable>
        <Text className="text-center text-[11px] text-gray-400">
          Close it to answer later from your Inbox.
        </Text>
      </View>
    </View>
  );
}
