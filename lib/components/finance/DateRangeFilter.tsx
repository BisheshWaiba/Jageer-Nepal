// lib/components/finance/DateRangeFilter.tsx
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DateField } from '../DateTimeFields';
import { useCalendarMode, type CalendarMode } from '../../hooks/useCalendarMode';
import { BS_MONTHS, adStringToBs } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';

// Dates throughout are 'YYYY-MM-DD'; '' means "no limit on this side".

function shiftDay(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const s = new Date(y, m - 1, d + delta);
  return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
}

/** "Aswin 14" (Bikram Sambat) or "Oct 1" - short enough for a button. */
function shortLabel(ymd: string, mode: CalendarMode): string {
  if (mode === 'ad') {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  const bs = adStringToBs(ymd);
  return bs ? `${BS_MONTHS[bs.month]} ${bs.date}` : ymd;
}

function rangeLabel(from: string, to: string, mode: CalendarMode): string {
  if (from && to) return from === to ? shortLabel(from, mode) : `${shortLabel(from, mode)} – ${shortLabel(to, mode)}`;
  return from ? `From ${shortLabel(from, mode)}` : `Until ${shortLabel(to, mode)}`;
}

const PRESETS = [
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
] as const;

/** The Filter button. It shows the range that is on (or just "Filter") and opens
 * a dialog with two ways in: one tap for "the last 7 / 14 / 30 days" (counting
 * today as the last day), which applies straight away, or From and To dates
 * chosen on the calendar, which apply when you press Apply. */
export function DateFilterButton({ from, to, onApply }: { from: string; to: string; onApply: (from: string, to: string) => void }) {
  const [mode] = useCalendarMode();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const active = !!from || !!to;
  const today = localTodayIso();

  const openDialog = () => {
    setDraftFrom(from);
    setDraftTo(to);
    setOpen(true);
  };
  const applyRange = (f: string, t: string) => {
    setOpen(false);
    onApply(f, t);
  };
  const apply = () => {
    // A From after the To is just the two the wrong way round.
    if (draftFrom && draftTo && draftFrom > draftTo) applyRange(draftTo, draftFrom);
    else applyRange(draftFrom, draftTo);
  };

  return (
    <>
      <View className="flex-row items-center" style={{ gap: 6 }}>
        <Pressable
          onPress={openDialog}
          accessibilityLabel="Filter by date"
          className="h-9 flex-row items-center rounded-lg border px-3"
          style={{ gap: 6, borderColor: active ? '#2563EB' : '#D1D5DB', backgroundColor: active ? '#EFF6FF' : '#FFFFFF' }}
        >
          <Ionicons name="funnel-outline" size={14} color={active ? '#1D4ED8' : '#4B5563'} />
          <Text className={`text-[13px] font-semibold ${active ? 'text-blue-700' : 'text-gray-700'}`} numberOfLines={1} style={{ maxWidth: 170 }}>
            {active ? rangeLabel(from, to, mode) : 'Filter'}
          </Text>
        </Pressable>
        {active && (
          <Pressable onPress={() => onApply('', '')} hitSlop={8} accessibilityLabel="Clear dates">
            <Ionicons name="close-circle" size={18} color="#9CA3AF" />
          </Pressable>
        )}
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full rounded-2xl bg-white" style={{ maxWidth: 420, padding: 24, boxShadow: '0 20px 50px rgba(16,24,40,0.25)' }}>
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-lg font-extrabold text-gray-900">Filter by date</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityLabel="Close">
                <Ionicons name="close" size={24} color="#374151" />
              </Pressable>
            </View>

            <Text className="mb-2 text-xs font-semibold text-gray-500">Last</Text>
            <View className="flex-row" style={{ gap: 8 }}>
              {PRESETS.map((p) => {
                const start = shiftDay(today, -(p.days - 1));
                const on = from === start && to === today;
                return (
                  <Pressable
                    key={p.days}
                    onPress={() => applyRange(start, today)}
                    accessibilityLabel={`Last ${p.label}`}
                    className="flex-1 items-center rounded-xl border py-2.5"
                    style={{ borderColor: on ? '#2563EB' : '#D1D5DB', backgroundColor: on ? '#EFF6FF' : '#FFFFFF' }}
                  >
                    <Text className={`text-sm font-bold ${on ? 'text-blue-700' : 'text-gray-700'}`}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View className="my-5 flex-row items-center" style={{ gap: 10 }}>
              <View className="h-px flex-1 bg-gray-200" />
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">or pick dates</Text>
              <View className="h-px flex-1 bg-gray-200" />
            </View>

            <Text className="mb-1 text-xs font-semibold text-gray-500">From</Text>
            <DateField value={draftFrom} onChange={(v) => v && setDraftFrom(v)} />
            <Text className="mb-1 mt-3 text-xs font-semibold text-gray-500">To</Text>
            <DateField value={draftTo} onChange={(v) => v && setDraftTo(v)} />
            <Text className="mt-2 text-[11px] text-gray-400">Leave one empty for no limit on that side.</Text>

            <View className="mt-5 flex-row items-center" style={{ gap: 10 }}>
              <Pressable
                onPress={() => {
                  setDraftFrom('');
                  setDraftTo('');
                }}
                className="rounded-xl border border-gray-300 px-4 py-3"
              >
                <Text className="text-sm font-bold text-gray-600">Clear</Text>
              </Pressable>
              <View className="flex-1" />
              <Pressable onPress={() => setOpen(false)} className="rounded-xl border border-gray-300 px-5 py-3">
                <Text className="text-sm font-bold text-gray-600">Cancel</Text>
              </Pressable>
              <Pressable onPress={apply} accessibilityLabel="Apply dates" className="rounded-xl px-6 py-3" style={{ backgroundColor: '#1D4ED8' }}>
                <Text className="text-sm font-bold text-white">Apply</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
