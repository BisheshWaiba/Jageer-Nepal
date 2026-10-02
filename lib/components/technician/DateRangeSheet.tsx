// lib/components/technician/DateRangeSheet.tsx
import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut, ReduceMotion, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AD_MAX_YEAR, AD_MIN_YEAR, AD_MONTH_LABELS, BS_MAX_YEAR, BS_MIN_YEAR, YearMonthPicker } from '../DateTimeFields';
import { dateLabels, useCalendarMode, type CalendarMode } from '../../hooks/useCalendarMode';
import { BS_MONTHS, adStringToBsOrToday, bsDaysInMonth, bsToAdString, bsWeekdayOfFirst } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import type { DateRange } from '../../utils/dashboardStats';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const pad = (n: number) => String(n).padStart(2, '0');

interface MonthView {
  year: number;
  month: number; // 0-based, in whichever calendar is showing
}

function viewFor(mode: CalendarMode, iso: string): MonthView {
  if (mode === 'bs') {
    const bs = adStringToBsOrToday(iso);
    return { year: bs.year, month: bs.month };
  }
  const [y, m] = iso.split('-').map(Number);
  return { year: y, month: m - 1 };
}

/** Pick one day or a range of days, in BS (the default, like every date in
 * the app) or AD. A bottom sheet on a phone, a card in the middle on a wide
 * screen. Nothing changes until Apply - closing throws the picks away. */
export function DateRangeSheet({
  visible,
  initial,
  wide,
  onApply,
  onToday,
  onClose,
}: {
  visible: boolean;
  initial: DateRange;
  wide: boolean;
  onApply: (range: DateRange) => void;
  onToday: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useCalendarMode();
  const [a, setA] = useState(initial.start);
  const [b, setB] = useState(initial.end === initial.start ? '' : initial.end);
  const [view, setView] = useState<MonthView>(() => viewFor(mode, initial.start));
  const [pickingMonth, setPickingMonth] = useState(false);

  // Each time the sheet opens it starts from the range now in use.
  useEffect(() => {
    if (!visible) return;
    setA(initial.start);
    setB(initial.end === initial.start ? '' : initial.end);
    setView(viewFor(mode, initial.start));
    setPickingMonth(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const end = b || a;
  const lo = mode === 'bs' ? BS_MIN_YEAR : AD_MIN_YEAR;
  const hi = mode === 'bs' ? BS_MAX_YEAR : AD_MAX_YEAR;

  function pickDay(iso: string) {
    if (!a || b) {
      setA(iso);
      setB('');
    } else if (iso === a) {
      setB('');
    } else if (iso < a) {
      setB(a);
      setA(iso);
    } else {
      setB(iso);
    }
  }

  function step(delta: number) {
    let year = view.year;
    let month = view.month + delta;
    if (month < 0) {
      month = 11;
      year -= 1;
    } else if (month > 11) {
      month = 0;
      year += 1;
    }
    if (year < lo || year > hi) return;
    setView({ year, month });
  }

  function switchMode(next: CalendarMode) {
    setMode(next);
    setView(viewFor(next, a || localTodayIso()));
    setPickingMonth(false);
  }

  const daysInMonth = mode === 'bs' ? bsDaysInMonth(view.year, view.month) : new Date(view.year, view.month + 1, 0).getDate();
  const firstWeekday = mode === 'bs' ? bsWeekdayOfFirst(view.year, view.month) : new Date(view.year, view.month, 1).getDay();
  const isoFor = (d: number) => (mode === 'bs' ? bsToAdString(view.year, view.month, d) : `${view.year}-${pad(view.month + 1)}-${pad(d)}`);
  const monthLabel = `${(mode === 'bs' ? BS_MONTHS : AD_MONTH_LABELS)[view.month]} ${view.year}`;

  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const from = a ? dateLabels(a, mode) : ['', ''];
  const to = b ? dateLabels(b, mode) : ['', ''];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)} exiting={FadeOut.duration(140).reduceMotion(ReduceMotion.System)} style={{ flex: 1 }}>
        <Pressable
          accessibilityLabel="Close calendar"
          onPress={onClose}
          className="flex-1 bg-black/40"
          style={{ justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', paddingHorizontal: wide ? 24 : 0 }}
        >
          <Animated.View
            entering={SlideInDown.duration(260).reduceMotion(ReduceMotion.System)}
            exiting={SlideOutDown.duration(180).reduceMotion(ReduceMotion.System)}
            style={{ width: '100%', maxWidth: wide ? 384 : undefined }}
          >
            <Pressable
              onPress={() => {}}
              accessibilityViewIsModal
              className="w-full bg-white px-4 pt-4"
              style={{
                borderRadius: wide ? 12 : 0,
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                paddingBottom: 16 + (wide ? 0 : insets.bottom),
                maxHeight: wide ? undefined : '92%',
              }}
            >
              {!wide && <View className="mb-3 self-center rounded-full bg-gray-300" style={{ width: 36, height: 4 }} />}

              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-base font-semibold text-gray-900">Select dates</Text>
                <View className="flex-row items-center gap-2">
                  <Pressable onPress={onToday} className="rounded-full border border-blue-600 px-3 py-1" style={{ minHeight: 28 }}>
                    <Text className="text-xs font-semibold text-blue-700">Today</Text>
                  </Pressable>
                  <View className="flex-row rounded-full bg-gray-100 p-0.5">
                    {(['bs', 'ad'] as const).map((m) => (
                      <Pressable
                        key={m}
                        onPress={() => switchMode(m)}
                        accessibilityState={{ selected: mode === m }}
                        className={`rounded-full px-3 py-1 ${mode === m ? 'bg-orange-500' : ''}`}
                      >
                        <Text className={`text-xs font-semibold ${mode === m ? 'text-white' : 'text-gray-600'}`}>{m.toUpperCase()}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>

              <View className="mb-3 flex-row gap-2">
                <View className="flex-1">
                  <Text className="mb-1 text-[11px] font-semibold text-gray-500">From</Text>
                  <View className="justify-center rounded-lg border border-gray-300 bg-white px-3 py-1.5" style={{ minHeight: 50 }}>
                    <Text className="text-xs font-bold text-gray-900">{from[0]}</Text>
                    <Text className="mt-0.5 text-[10px] text-gray-500">{from[1]}</Text>
                  </View>
                </View>
                <View className="flex-1">
                  <Text className="mb-1 text-[11px] font-semibold text-gray-500">To</Text>
                  <View className="justify-center rounded-lg border border-gray-300 bg-white px-3 py-1.5" style={{ minHeight: 50 }}>
                    <Text className={b ? 'text-xs font-bold text-gray-900' : 'text-xs font-medium text-gray-500'}>{b ? to[0] : 'Same day'}</Text>
                    <Text className="mt-0.5 text-[10px] text-gray-500">{b ? to[1] : 'Tap another date for a range'}</Text>
                  </View>
                </View>
              </View>

              {pickingMonth ? (
                <YearMonthPicker
                  monthNames={mode === 'bs' ? BS_MONTHS : AD_MONTH_LABELS}
                  minYear={lo}
                  maxYear={hi}
                  year={view.year}
                  month={view.month}
                  onSelectYear={(year) => setView((v) => ({ ...v, year }))}
                  onSelectMonth={(month) => setView((v) => ({ ...v, month }))}
                  onDone={() => setPickingMonth(false)}
                />
              ) : (
                <View>
                  <View className="mb-2 flex-row items-center justify-between">
                    <Pressable onPress={() => step(-1)} accessibilityLabel="Previous month" className="h-11 w-11 items-center justify-center rounded-full">
                      <Ionicons name="chevron-back" size={20} color="#374151" />
                    </Pressable>
                    <Pressable onPress={() => setPickingMonth(true)} className="flex-row items-center gap-1 px-2" style={{ minHeight: 44 }}>
                      <Text className="text-sm font-semibold text-gray-900">{monthLabel}</Text>
                      <Ionicons name="chevron-down" size={14} color="#6B7280" />
                    </Pressable>
                    <Pressable onPress={() => step(1)} accessibilityLabel="Next month" className="h-11 w-11 items-center justify-center rounded-full">
                      <Ionicons name="chevron-forward" size={20} color="#374151" />
                    </Pressable>
                  </View>
                  <View className="flex-row">
                    {WEEKDAYS.map((w) => (
                      <Text key={w} className="flex-1 text-center text-[11px] font-medium text-gray-500">
                        {w}
                      </Text>
                    ))}
                  </View>
                  <View className="flex-row flex-wrap">
                    {cells.map((day, idx) => {
                      if (day == null) return <View key={idx} style={{ width: '14.2857%', height: 40 }} />;
                      const iso = isoFor(day);
                      const isStart = iso === a;
                      const isEnd = iso === end;
                      const selected = isStart || isEnd;
                      const range = !!a && end !== a;
                      const mid = range && iso > a && iso < end;
                      const band = range && (mid || isStart || isEnd);
                      return (
                        <View key={idx} style={{ width: '14.2857%', height: 40, alignItems: 'center', justifyContent: 'center' }}>
                          {band && (
                            <View
                              className="bg-orange-100"
                              style={{ position: 'absolute', top: 2, bottom: 2, left: isStart ? '50%' : 0, right: isEnd ? '50%' : 0 }}
                            />
                          )}
                          <Pressable
                            onPress={() => pickDay(iso)}
                            accessibilityLabel={dateLabels(iso, mode)[0]}
                            accessibilityState={{ selected }}
                            className={`h-9 w-9 items-center justify-center rounded-full ${selected ? 'bg-orange-500' : ''}`}
                          >
                            <Text className={selected ? 'text-sm font-bold text-white' : 'text-sm text-gray-800'}>{day}</Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}

              <View className="mt-3 flex-row gap-2">
                <Pressable onPress={onClose} className="flex-1 items-center justify-center rounded-lg border border-gray-300 bg-white" style={{ minHeight: 44 }}>
                  <Text className="text-sm font-semibold text-gray-600">Close</Text>
                </Pressable>
                <Pressable
                  onPress={() => a && onApply({ start: a, end: end })}
                  disabled={!a}
                  className="flex-1 items-center justify-center rounded-lg bg-blue-600 disabled:opacity-50"
                  style={{ minHeight: 44 }}
                >
                  <Text className="text-sm font-semibold text-white">Apply</Text>
                </Pressable>
              </View>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}
