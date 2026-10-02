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

const STEPS = ['Assigned', 'Accepted', 'Working', 'Completed'] as const;

/** Four-step bar: how far the job has got. Cancelled jobs show no bar. */
export function JobProgress({ job }: { job: TeamJob }) {
  const { request, acceptedAt } = job;
  // Index of the step the job is on; steps before it are done.
  const at = request.status === 'resolved' ? 3 : request.status === 'in_progress' ? 2 : acceptedAt ? 1 : 0;
  const finished = request.status === 'resolved';
  return (
    <View className="mt-3 flex-row items-start">
      {STEPS.map((label, i) => {
        const done = i < at || (finished && i === at);
        const current = i === at && !finished;
        const color = done ? '#059669' : current ? '#2563EB' : '#D1D5DB';
        return (
          <View key={label} className="flex-1 items-center">
            <View className="w-full flex-row items-center">
              <View className="h-[3px] flex-1" style={{ backgroundColor: i === 0 ? 'transparent' : i <= at ? '#059669' : '#E5E7EB' }} />
              <View
                className="items-center justify-center rounded-full"
                style={{ width: 20, height: 20, backgroundColor: done || current ? color : '#FFFFFF', borderWidth: 2, borderColor: color }}
              >
                {done ? <Ionicons name="checkmark" size={12} color="#fff" /> : current ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} /> : null}
              </View>
              <View className="h-[3px] flex-1" style={{ backgroundColor: i === STEPS.length - 1 ? 'transparent' : i < at ? '#059669' : '#E5E7EB' }} />
            </View>
            <Text className="mt-1 text-[10.5px] font-semibold" style={{ color: done || current ? '#111827' : '#9CA3AF' }}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** One job: what it is, who has it, a prominent "assigned" time, a progress
 * bar, and when it was accepted / how long the work took. */
export function TeamJobRow({
  job,
  technicianName,
  compact,
  last,
}: {
  job: TeamJob;
  technicianName?: string;
  /** Finished jobs collapse to one line; active jobs keep the full detail. */
  compact?: boolean;
  last?: boolean;
}) {
  const now = useTick();
  const { request, acceptedAt, completedAt, running } = job;
  const status = STATUS_STYLES[request.status];
  const assignedIso = request.assigned_at ?? request.created_at;
  const work =
    job.workMs == null
      ? request.status === 'assigned'
        ? 'Not accepted yet'
        : '-'
      : formatDuration(running && acceptedAt ? now - new Date(acceptedAt).getTime() : job.workMs);
  const waiting = request.status === 'assigned' ? `Waiting ${formatDuration(now - new Date(assignedIso).getTime())}` : null;
  const showProgress = request.status !== 'cancelled' && request.status !== 'pending' && request.status !== 'approved' && request.status !== 'quoted';

  if (compact && request.status === 'resolved') {
    return (
      <Pressable
        onPress={() => router.push(`/(reseller)/request/${request.id}` as any)}
        className={`flex-row items-center gap-3 px-4 py-3 active:bg-gray-50 ${last ? '' : 'border-b border-gray-100'}`}
        accessibilityRole="button"
        accessibilityLabel={`${request.issue_type}, done`}
      >
        <Ionicons name="checkmark-circle" size={18} color="#15803D" />
        <View className="flex-1">
          <Text className="text-[13.5px] font-semibold text-gray-900" numberOfLines={1}>
            {request.issue_type}
          </Text>
          <Text className="text-xs text-gray-500" numberOfLines={1}>
            {[technicianName, request.customer_name].filter(Boolean).join(' · ') || 'No customer name'}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-xs font-bold text-green-700">{work === '-' ? 'Done' : `Done · ${work}`}</Text>
          <Text className="text-[11px] text-gray-400">{formatTimestamp(completedAt ?? assignedIso)}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => router.push(`/(reseller)/request/${request.id}` as any)}
      className={`px-4 py-3.5 active:bg-gray-50 ${last ? '' : 'border-b border-gray-100'}`}
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

      <View className="mt-2.5 flex-row items-center gap-2 rounded-lg bg-blue-50 px-3 py-2">
        <Ionicons name="paper-plane" size={15} color="#1D4ED8" />
        <View className="flex-1">
          <Text className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Assigned</Text>
          <Text className="text-[14px] font-bold text-blue-950" style={{ color: '#1E3A8A' }}>
            {formatTimestamp(assignedIso)}
          </Text>
        </View>
        <Text className="text-xs font-medium text-blue-700">{ago(assignedIso, now)}</Text>
      </View>

      {showProgress && <JobProgress job={job} />}

      <View className="mt-3 flex-row flex-wrap" style={{ gap: 10 }}>
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
