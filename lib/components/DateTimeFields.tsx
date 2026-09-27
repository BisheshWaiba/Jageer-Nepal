// lib/components/DateTimeFields.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  BS_MONTHS,
  adStringToBs,
  adStringToBsOrToday,
  bsDaysInMonth,
  bsToAdString,
  bsWeekdayOfFirst,
} from '../utils/nepaliDate';
import { dateLabels, useCalendarMode } from '../hooks/useCalendarMode';

function parseDateValue(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

function formatDateValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Shared trigger height for DateField and TimeField.
const FIELD_MIN_HEIGHT = 50;

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const AD_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface CalendarGridSpec {
  monthLabel: string;
  daysInMonth: number;
  firstWeekday: number;
}

/** A month grid shared by both calendars - leading blanks for the 1st's
 * weekday offset, then 1..daysInMonth, padded to full weeks. Which calendar
 * it's showing is entirely decided by the `spec` passed in, so switching
 * between AD and BS always produces a visibly different header and day
 * count instead of silently reusing whatever was already on screen. */
function MonthCalendarGrid({
  spec,
  selectedDate,
  onSelectDay,
  onNavigate,
  onTapHeader,
}: {
  spec: CalendarGridSpec;
  selectedDate: number | null;
  onSelectDay: (day: number) => void;
  onNavigate: (deltaMonths: number) => void;
  onTapHeader: () => void;
}) {
  const cells: (number | null)[] = [
    ...Array(spec.firstWeekday).fill(null),
    ...Array.from({ length: spec.daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <View>
      <View className="mb-3 flex-row items-center justify-between">
        <Pressable onPress={() => onNavigate(-1)} hitSlop={8} className="p-1">
          <Ionicons name="chevron-back" size={20} color="#374151" />
        </Pressable>
        {/* Tapping the label (not just the arrows) jumps to a year/month
            list - picking, say, 5 years back used to mean 60 taps on the
            chevron. */}
        <Pressable onPress={onTapHeader} className="flex-row items-center gap-1 px-2 py-1">
          <Text className="text-sm font-semibold text-gray-900">{spec.monthLabel}</Text>
          <Ionicons name="chevron-down" size={14} color="#6B7280" />
        </Pressable>
        <Pressable onPress={() => onNavigate(1)} hitSlop={8} className="p-1">
          <Ionicons name="chevron-forward" size={20} color="#374151" />
        </Pressable>
      </View>
      <View className="flex-row">
        {WEEKDAY_LABELS.map((w) => (
          <Text key={w} className="flex-1 text-center text-[11px] font-medium text-gray-400">
            {w}
          </Text>
        ))}
      </View>
      <View className="flex-row flex-wrap">
        {cells.map((day, idx) => (
          <View key={idx} style={{ width: '14.2857%' }} className="items-center py-1">
            {day != null && (
              <Pressable
                onPress={() => onSelectDay(day)}
                className={`h-8 w-8 items-center justify-center rounded-full ${day === selectedDate ? 'bg-orange-500' : ''}`}
              >
                <Text className={day === selectedDate ? 'text-sm font-bold text-white' : 'text-sm text-gray-800'}>{day}</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

// The BS<->AD conversion (NepaliDate) only works inside BS 2000-2090, which
// is roughly this AD window - both lists are clamped to it so nothing here
// can ever land on a year the converter would throw on.
const BS_MIN_YEAR = 2000;
const BS_MAX_YEAR = 2090;
const AD_MIN_YEAR = 1943;
const AD_MAX_YEAR = 2033;

/** Jump straight to a year and month instead of stepping through one month
 * at a time - opened by tapping the calendar header. Two columns, side by
 * side and independently scrollable (month names on the left, years on the
 * right), each auto-scrolled to whatever's already selected; tapping either
 * applies it immediately, no separate confirm step. */
function YearMonthPicker({
  monthNames,
  minYear,
  maxYear,
  year,
  month,
  onSelectYear,
  onSelectMonth,
  onDone,
}: {
  monthNames: string[];
  minYear: number;
  maxYear: number;
  year: number;
  month: number;
  onSelectYear: (y: number) => void;
  onSelectMonth: (m: number) => void;
  onDone: () => void;
}) {
  const years = useMemo(() => Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i), [minYear, maxYear]);
  const monthScrollRef = useRef<ScrollView>(null);
  const yearScrollRef = useRef<ScrollView>(null);
  const ROW = 40;
  const VISIBLE = 6;

  useEffect(() => {
    const yearIndex = years.indexOf(year);
    const id = setTimeout(() => {
      monthScrollRef.current?.scrollTo({ y: Math.max(0, month - 2) * ROW, animated: false });
      yearScrollRef.current?.scrollTo({ y: Math.max(0, yearIndex - 2) * ROW, animated: false });
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View>
      <View className="flex-row overflow-hidden rounded-lg border border-gray-200" style={{ height: ROW * VISIBLE }}>
        <ScrollView ref={monthScrollRef} className="flex-1 border-r border-gray-200" showsVerticalScrollIndicator>
          {monthNames.map((name, i) => (
            <Pressable
              key={name}
              onPress={() => onSelectMonth(i)}
              style={{ height: ROW }}
              className={`justify-center px-3 ${i === month ? 'bg-blue-50' : ''}`}
            >
              <Text className={i === month ? 'text-sm font-bold text-blue-700' : 'text-sm text-gray-700'}>{name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView ref={yearScrollRef} className="flex-1" showsVerticalScrollIndicator>
          {years.map((y) => (
            <Pressable
              key={y}
              onPress={() => onSelectYear(y)}
              style={{ height: ROW }}
              className={`items-center justify-center ${y === year ? 'bg-blue-50' : ''}`}
            >
              <Text className={y === year ? 'text-sm font-bold text-blue-700' : 'text-sm text-gray-700'}>{y}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <Pressable onPress={onDone} className="mt-3 items-center rounded-lg border border-gray-300 py-2">
        <Text className="text-sm font-semibold text-gray-600">Back to calendar</Text>
      </Pressable>
    </View>
  );
}

/** Date picker defaulting to a BS (Bikram Sambat) calendar grid - the
 * calendar Nepal actually runs on day-to-day - with a real toggle to an AD
 * (Gregorian) grid for anyone who wants that instead. Both are the same
 * kind of custom grid (no native OS picker involved), so switching between
 * them always visibly changes the header/day layout rather than risking a
 * silent no-op. Always stores/reports the value as an AD 'YYYY-MM-DD'
 * string either way, since that's the shape every date column already uses. */
export function DateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [showPicker, setShowPicker] = useState(false);
  // The BS/AD toggle is shared app-wide (and remembered), so picking AD here
  // switches this field's label, every other date field and date headings
  // like the Day Book - not just the grid inside this one popup.
  const [mode, setMode] = useCalendarMode();
  const [showYearMonthPicker, setShowYearMonthPicker] = useState(false);
  // bsSpec/adSpec below are computed on every render (not just while the
  // picker is open) to feed the always-visible trigger label too, so these
  // must never sit at an invalid default like 0 - NepaliDate throws outside
  // BS 2000-2090, which crashed the app on mount before the first tap ever
  // set a real year/month.
  const [bsYear, setBsYear] = useState(() => adStringToBsOrToday(value || formatDateValue(new Date())).year);
  const [bsMonth, setBsMonth] = useState(() => adStringToBsOrToday(value || formatDateValue(new Date())).month);
  const [adYear, setAdYear] = useState(() => (value ? parseDateValue(value) : new Date()).getFullYear());
  const [adMonth, setAdMonth] = useState(() => (value ? parseDateValue(value) : new Date()).getMonth());

  function openPicker() {
    const base = value || formatDateValue(new Date());
    const bs = adStringToBsOrToday(base);
    setBsYear(bs.year);
    setBsMonth(bs.month);
    const ad = parseDateValue(base);
    setAdYear(ad.getFullYear());
    setAdMonth(ad.getMonth());
    setShowYearMonthPicker(false);
    setShowPicker(true);
  }

  function navigateBs(delta: number) {
    let m = bsMonth + delta;
    let y = bsYear;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setBsMonth(m);
    setBsYear(y);
  }

  function navigateAd(delta: number) {
    let m = adMonth + delta;
    let y = adYear;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setAdMonth(m);
    setAdYear(y);
  }

  function selectBsDay(day: number) {
    onChange(bsToAdString(bsYear, bsMonth, day));
    setShowPicker(false);
  }

  function selectAdDay(day: number) {
    onChange(formatDateValue(new Date(adYear, adMonth, day)));
    setShowPicker(false);
  }

  const selectedBs = value ? adStringToBs(value) : null;
  const bsSelectedDay = selectedBs && selectedBs.year === bsYear && selectedBs.month === bsMonth ? selectedBs.date : null;

  const selectedAd = value ? parseDateValue(value) : null;
  const adSelectedDay =
    selectedAd && selectedAd.getFullYear() === adYear && selectedAd.getMonth() === adMonth ? selectedAd.getDate() : null;

  const bsSpec: CalendarGridSpec = {
    monthLabel: `${BS_MONTHS[bsMonth]} ${bsYear}`,
    daysInMonth: bsDaysInMonth(bsYear, bsMonth),
    firstWeekday: bsWeekdayOfFirst(bsYear, bsMonth),
  };
  const adSpec: CalendarGridSpec = {
    monthLabel: `${AD_MONTH_NAMES[adMonth]} ${adYear}`,
    daysInMonth: new Date(adYear, adMonth + 1, 0).getDate(),
    firstWeekday: new Date(adYear, adMonth, 1).getDay(),
  };

  return (
    <View>
      {/* Same height and placeholder style as TimeField, so the two line up
          when they sit side by side (they didn't while the date was empty). */}
      <Pressable
        onPress={openPicker}
        className="justify-center rounded-lg border border-gray-300 bg-white px-3 py-1.5"
        style={{ minHeight: FIELD_MIN_HEIGHT }}
      >
        <Text className={value ? 'text-xs font-bold text-gray-900' : 'text-base text-gray-400'}>
          {value ? dateLabels(value, mode)[0] : 'Select a date'}
        </Text>
        {!!value && <Text className="mt-0.5 text-[10px] text-gray-500">{dateLabels(value, mode)[1]}</Text>}
      </Pressable>

      <Modal visible={showPicker} transparent animationType="fade" onRequestClose={() => setShowPicker(false)}>
        <Pressable className="flex-1 items-center justify-center bg-black/40 px-6" onPress={() => setShowPicker(false)}>
          <Pressable onPress={() => {}} className="w-full max-w-sm rounded-xl bg-white p-4">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-base font-semibold text-gray-900">Select a date</Text>
              <View className="flex-row items-center gap-2">
                {/* Jumps straight to today and applies it - the calendar
                    otherwise opens on whatever date is already set (e.g. an
                    old scanned bill date), which can be many months of
                    chevron-tapping away from today. */}
                <Pressable
                  onPress={() => {
                    onChange(formatDateValue(new Date()));
                    setShowPicker(false);
                  }}
                  className="rounded-full border border-blue-600 px-3 py-1"
                >
                  <Text className="text-xs font-semibold text-blue-700">Today</Text>
                </Pressable>
                <View className="flex-row rounded-full bg-gray-100 p-0.5">
                  <Pressable
                    onPress={() => {
                      setMode('bs');
                      setShowYearMonthPicker(false);
                    }}
                    className={`rounded-full px-3 py-1 ${mode === 'bs' ? 'bg-orange-500' : ''}`}
                  >
                    <Text className={`text-xs font-semibold ${mode === 'bs' ? 'text-white' : 'text-gray-600'}`}>BS</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setMode('ad');
                      setShowYearMonthPicker(false);
                    }}
                    className={`rounded-full px-3 py-1 ${mode === 'ad' ? 'bg-orange-500' : ''}`}
                  >
                    <Text className={`text-xs font-semibold ${mode === 'ad' ? 'text-white' : 'text-gray-600'}`}>AD</Text>
                  </Pressable>
                </View>
              </View>
            </View>
            {showYearMonthPicker ? (
              mode === 'bs' ? (
                <YearMonthPicker
                  monthNames={BS_MONTHS}
                  minYear={BS_MIN_YEAR}
                  maxYear={BS_MAX_YEAR}
                  year={bsYear}
                  month={bsMonth}
                  onSelectYear={setBsYear}
                  onSelectMonth={setBsMonth}
                  onDone={() => setShowYearMonthPicker(false)}
                />
              ) : (
                <YearMonthPicker
                  monthNames={AD_MONTH_NAMES}
                  minYear={AD_MIN_YEAR}
                  maxYear={AD_MAX_YEAR}
                  year={adYear}
                  month={adMonth}
                  onSelectYear={setAdYear}
                  onSelectMonth={setAdMonth}
                  onDone={() => setShowYearMonthPicker(false)}
                />
              )
            ) : mode === 'bs' ? (
              <MonthCalendarGrid
                spec={bsSpec}
                selectedDate={bsSelectedDay}
                onSelectDay={selectBsDay}
                onNavigate={navigateBs}
                onTapHeader={() => setShowYearMonthPicker(true)}
              />
            ) : (
              <MonthCalendarGrid
                spec={adSpec}
                selectedDate={adSelectedDay}
                onSelectDay={selectAdDay}
                onNavigate={navigateAd}
                onTapHeader={() => setShowYearMonthPicker(true)}
              />
            )}
            <Pressable onPress={() => setShowPicker(false)} className="mt-3 items-center rounded-lg border border-gray-300 py-2">
              <Text className="text-sm font-semibold text-gray-600">Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const SLOT_MINUTES = 15;
const ROW_HEIGHT = 44;
const VISIBLE_ROWS = 5;

// 24-hour "HH:MM" slots in 15-minute steps, e.g. 00:00, 00:15, ... 23:45.
const TIME_SLOTS = Array.from({ length: (24 * 60) / SLOT_MINUTES }, (_, i) => {
  const totalMinutes = i * SLOT_MINUTES;
  const h = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const m = String(totalMinutes % 60).padStart(2, '0');
  return `${h}:${m}`;
});

function nearestSlotIndexToNow(): number {
  const now = new Date();
  const rounded = Math.round((now.getHours() * 60 + now.getMinutes()) / SLOT_MINUTES);
  return Math.min(rounded, TIME_SLOTS.length - 1);
}

/** A single box that opens a popup with a scrollable list of 24-hour time slots (e.g. 20:00, 20:15, 20:30...) to pick from. */
export function TimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [showPicker, setShowPicker] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!showPicker) return;
    const index = value ? TIME_SLOTS.indexOf(value) : nearestSlotIndexToNow();
    // Wait a tick so the ScrollView inside the just-opened modal has mounted before jumping.
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, index) * ROW_HEIGHT, animated: false });
    }, 0);
    return () => clearTimeout(id);
  }, [showPicker]);

  return (
    <View>
      <Pressable
        onPress={() => setShowPicker(true)}
        className="justify-center rounded-lg border border-gray-300 bg-white px-4"
        style={{ minHeight: FIELD_MIN_HEIGHT }}
      >
        <Text className={value ? 'text-base text-gray-900' : 'text-base text-gray-400'}>
          {value || 'Select a time'}
        </Text>
      </Pressable>

      <Modal visible={showPicker} transparent animationType="fade" onRequestClose={() => setShowPicker(false)}>
        <Pressable
          className="flex-1 items-center justify-center bg-black/40"
          onPress={() => setShowPicker(false)}
        >
          <Pressable onPress={() => {}} className="w-64 rounded-xl bg-white p-3">
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-base font-semibold text-gray-900">Select a time</Text>
              <Pressable onPress={() => setShowPicker(false)} className="px-2 py-1">
                <Text className="text-sm font-semibold text-blue-700">Done</Text>
              </Pressable>
            </View>
            <ScrollView
              ref={scrollRef}
              style={{ height: ROW_HEIGHT * VISIBLE_ROWS }}
              showsVerticalScrollIndicator={true}
            >
              {TIME_SLOTS.map((slot) => {
                const selected = slot === value;
                return (
                  <Pressable
                    key={slot}
                    onPress={() => {
                      onChange(slot);
                      setShowPicker(false);
                    }}
                    style={{ height: ROW_HEIGHT }}
                    className={`justify-center border-b border-gray-100 px-4 ${selected ? 'bg-blue-50' : ''}`}
                  >
                    <Text className={selected ? 'text-base font-semibold text-blue-700' : 'text-base text-gray-700'}>
                      {slot}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
