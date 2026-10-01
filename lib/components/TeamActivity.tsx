// lib/components/TeamActivity.tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MapPreview } from './MapPreview';
import { STATUS_STYLES } from '../constants/requestStatus';
import { formatDuration, formatTimestamp } from '../utils/duration';
import type { TeamJob } from '../hooks/useTeamActivity';
import type { TechnicianLocation } from '../../types/database.types';

/** A position older than this is "last seen", not "here now". */
const FRESH_MS = 10 * 60_000;

/** Re-renders every 30s so "5m ago" keeps moving without a refetch. */
export function useTick(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function ago(iso: string, now = Date.now()) {
  const ms = now - new Date(iso).getTime();
  return ms < 60_000 ? 'just now' : `${formatDuration(ms)} ago`;
}

export function locationState(loc: TechnicianLocation | undefined, now = Date.now()) {
  if (!loc) return { label: 'No location yet', color: '#9CA3AF', fresh: false };
  const fresh = now - new Date(loc.updated_at).getTime() < FRESH_MS;
  return fresh
    ? { label: `Live · ${ago(loc.updated_at, now)}`, color: '#059669', fresh }
    : { label: `Last seen ${ago(loc.updated_at, now)}`, color: '#B45309', fresh };
}

function openMaps(loc: TechnicianLocation) {
  Linking.openURL(`https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`);
}

/** One line of "where are they": status dot + age, and the map when asked. */
export function LocationLine({ loc, showMap }: { loc: TechnicianLocation | undefined; showMap?: boolean }) {
  const now = useTick();
  const s = locationState(loc, now);
  return (
    <View>
      <View className="flex-row items-center gap-1.5">
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
        <Text className="text-xs font-medium" style={{ color: s.color }}>
          {s.label}
        </Text>
        {loc && !showMap && (
          <Pressable onPress={() => openMaps(loc)} hitSlop={6}>
            <Text className="ml-1 text-xs text-blue-600">Map →</Text>
          </Pressable>
        )}
      </View>
      {loc && showMap && (
        <View className="mt-2">
          <MapPreview coords={{ latitude: loc.latitude, longitude: loc.longitude }} height={180} />
        </View>
      )}
    </View>
  );
}

function Stat({ icon, label, value, tone }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; tone?: string }) {
  return (
    <View className="min-w-[96px] flex-1">
      <View className="flex-row items-center gap-1">
        <Ionicons name={icon} size={12} color="#6B7280" />
        <Text className="text-[10.5px] font-semibold uppercase text-gray-500">{label}</Text>
      </View>
      <Text className="mt-0.5 text-[12.5px] font-semibold" style={{ color: tone ?? '#111827' }}>
        {value}
      </Text>
    </View>
  );
}

/** One job in the timeline: what it is, who has it, when it was sent, when it
 * was accepted, and how long the work took. */
export function TeamJobRow({ job, technicianName }: { job: TeamJob; technicianName?: string }) {
  const now = useTick();
  const { request, acceptedAt, completedAt, running } = job;
  const status = STATUS_STYLES[request.status];
  const assigned = request.assigned_at ? formatTimestamp(request.assigned_at) : '-';
  const work =
    job.workMs == null
      ? request.status === 'assigned'
        ? 'Not accepted yet'
        : '-'
      : formatDuration(running && acceptedAt ? now - new Date(acceptedAt).getTime() : job.workMs);
  const waiting = request.status === 'assigned' && request.assigned_at ? `Waiting ${formatDuration(now - new Date(request.assigned_at).getTime())}` : null;

  return (
    <Pressable
      onPress={() => router.push(`/(reseller)/request/${request.id}` as any)}
      className="border-b border-gray-100 px-4 py-3 active:bg-gray-50"
    >
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <Text className="text-[14px] font-semibold text-gray-900" numberOfLines={1}>
            {request.issue_type}
          </Text>
          <Text className="text-xs text-gray-500" numberOfLines={1}>
            {[technicianName, request.customer_name].filter(Boolean).join(' · ') || 'No customer name'}
          </Text>
        </View>
        <View className={`rounded-full px-2 py-0.5 ${status.bg}`}>
          <Text className={`text-[10px] font-semibold uppercase ${status.text}`}>{status.label}</Text>
        </View>
      </View>
      <View className="mt-2 flex-row flex-wrap" style={{ gap: 10 }}>
        <Stat icon="paper-plane-outline" label="Assigned" value={assigned} />
        <Stat
          icon="play-circle-outline"
          label="Accepted"
          value={acceptedAt ? formatTimestamp(acceptedAt) : waiting ?? '-'}
          tone={waiting && !acceptedAt ? '#B45309' : undefined}
        />
        <Stat
          icon="timer-outline"
          label={completedAt ? 'Time taken' : 'Working for'}
          value={work}
          tone={running ? '#2563EB' : completedAt ? '#059669' : undefined}
        />
        {completedAt && <Stat icon="checkmark-circle-outline" label="Completed" value={formatTimestamp(completedAt)} />}
      </View>
      {request.hold_status !== 'none' && (
        <Text className="mt-1.5 text-[11px] font-medium text-amber-700">
          {request.hold_status === 'on_hold' ? 'On hold' : 'Hold requested'}
          {request.hold_note ? ` - ${request.hold_note}` : ''}
        </Text>
      )}
    </Pressable>
  );
}
