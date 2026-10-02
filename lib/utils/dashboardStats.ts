// lib/utils/dashboardStats.ts
import { BS_MONTHS, adStringToBs, bsDaysInMonth, bsToAdString } from './nepaliDate';
import type { CalendarMode } from '../hooks/useCalendarMode';

/** The numbers behind the technician dashboard, kept free of any screen code
 * so they can be checked on their own. Every date here is a local
 * 'YYYY-MM-DD' string (the device's own day, never UTC - see localDate.ts),
 * which sorts correctly as plain text. */

/** One finished job. `date` is the local day it was completed. */
export interface Completion {
  id: string;
  date: string;
  category: string;
  amount: number;
}

export interface DateRange {
  start: string;
  end: string;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---- plain-date helpers (UTC arithmetic on the y/m/d parts, so a daylight
// saving change on the device can never skip or repeat a day)

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}

export function isoOfLocalDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function isoOfUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function utcMs(iso: string): number {
  const [y, m, d] = parts(iso);
  return Date.UTC(y, m - 1, d);
}

const DAY_MS = 86400000;

export function addDaysIso(iso: string, n: number): string {
  return isoOfUtc(utcMs(iso) + n * DAY_MS);
}

/** Whole days from a to b (b - a). */
export function daysBetweenIso(a: string, b: string): number {
  return Math.round((utcMs(b) - utcMs(a)) / DAY_MS);
}

export function rangeDays(r: DateRange): number {
  return daysBetweenIso(r.start, r.end) + 1;
}

export type Preset = 'today' | 'week' | 'custom';

/** Today, or the last seven days counting today. */
export function presetRange(preset: 'today' | 'week', todayIso: string): DateRange {
  return preset === 'today' ? { start: todayIso, end: todayIso } : { start: addDaysIso(todayIso, -6), end: todayIso };
}

// ---- labels, in whichever calendar the person reads dates in

function shortDate(iso: string, mode: CalendarMode): string {
  if (mode === 'bs') {
    const bs = adStringToBs(iso);
    if (bs) return `${BS_MONTHS[bs.month]} ${bs.date}`;
  }
  const [, m, d] = parts(iso);
  return `${MON[m - 1]} ${d}`;
}

function fullDate(iso: string, mode: CalendarMode): string {
  if (mode === 'bs') {
    const bs = adStringToBs(iso);
    if (bs) return `${BS_MONTHS[bs.month]} ${bs.date}, ${bs.year} BS`;
  }
  const [y, m, d] = parts(iso);
  return `${MON[m - 1]} ${d}, ${y}`;
}

/** "Sep 26 - Oct 2, 2026" - the year is only written once when both ends share it. */
export function rangeLabel(r: DateRange, mode: CalendarMode): string {
  if (r.start === r.end) return fullDate(r.start, mode);
  const sameYear =
    mode === 'bs' && adStringToBs(r.start) && adStringToBs(r.end)
      ? adStringToBs(r.start)!.year === adStringToBs(r.end)!.year
      : parts(r.start)[0] === parts(r.end)[0];
  const first = sameYear ? shortDate(r.start, mode) : fullDate(r.start, mode);
  return `${first} – ${fullDate(r.end, mode)}`;
}

// ---- chart buckets

export type BucketKind = 'day' | 'week' | 'month' | 'year';

export interface Bucket {
  startIso: string;
  endIso: string;
  kind: BucketKind;
  /** Short text under the axis. */
  label: string;
  /** Full text at the top of the tooltip. */
  title: string;
}

export interface BucketLimits {
  /** Up to this many days: one point per day. */
  dailyMax: number;
  /** Up to this many days: one point per week. Longer: per month (per year past three years). */
  weeklyMax: number;
}

/** A wide screen can plot up to a month a day and about four months a week; a
 * phone has far less room per point, so it moves to coarser buckets sooner. */
export const WIDE_LIMITS: BucketLimits = { dailyMax: 31, weeklyMax: 120 };
export const NARROW_LIMITS: BucketLimits = { dailyMax: 10, weeklyMax: 70 };

function dayTitle(iso: string, mode: CalendarMode): string {
  const [y, m, d] = parts(iso);
  const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  if (mode === 'bs') {
    const bs = adStringToBs(iso);
    if (bs) return `${dow}, ${BS_MONTHS[bs.month]} ${bs.date}, ${bs.year} BS`;
  }
  return `${dow}, ${MON[m - 1]} ${d}, ${y}`;
}

interface CalendarMonth {
  startIso: string;
  endIso: string;
  year: number;
  /** 0-based month in the calendar being read. */
  month: number;
}

/** Calendar months overlapping the range, in the calendar being read. In BS
 * mode these are real BS months, so a bucket never straddles two of them. */
function calendarMonths(r: DateRange, mode: CalendarMode): CalendarMonth[] | null {
  const out: CalendarMonth[] = [];
  if (mode === 'bs') {
    const a = adStringToBs(r.start);
    const b = adStringToBs(r.end);
    if (!a || !b) return null;
    let y = a.year;
    let m = a.month;
    try {
      while (y < b.year || (y === b.year && m <= b.month)) {
        const first = bsToAdString(y, m, 1);
        const last = bsToAdString(y, m, bsDaysInMonth(y, m));
        out.push({ startIso: first, endIso: last, year: y, month: m });
        m += 1;
        if (m > 11) {
          m = 0;
          y += 1;
        }
      }
    } catch {
      return null;
    }
    return out;
  }
  let [y, m] = parts(r.start);
  const [ey, em] = parts(r.end);
  m -= 1;
  while (y < ey || (y === ey && m <= em - 1)) {
    const first = isoOfUtc(Date.UTC(y, m, 1));
    const last = isoOfUtc(Date.UTC(y, m + 1, 0));
    out.push({ startIso: first, endIso: last, year: y, month: m });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

function clip(startIso: string, endIso: string, r: DateRange): [string, string] {
  return [startIso < r.start ? r.start : startIso, endIso > r.end ? r.end : endIso];
}

/** The points along the chart's horizontal axis for a date range. */
export function buildBuckets(r: DateRange, limits: BucketLimits, mode: CalendarMode): Bucket[] {
  const days = rangeDays(r);
  const buckets: Bucket[] = [];

  if (days <= limits.dailyMax) {
    let prevMonthKey = '';
    for (let i = 0; i < days; i++) {
      const iso = addDaysIso(r.start, i);
      const bs = mode === 'bs' ? adStringToBs(iso) : null;
      const dayOfMonth = bs ? bs.date : parts(iso)[2];
      const monthKey = bs ? `${bs.year}-${bs.month}` : iso.slice(0, 7);
      const label = i === 0 || monthKey !== prevMonthKey ? shortDate(iso, mode) : String(dayOfMonth);
      prevMonthKey = monthKey;
      buckets.push({ startIso: iso, endIso: iso, kind: 'day', label, title: dayTitle(iso, mode) });
    }
    return buckets;
  }

  if (days <= limits.weeklyMax) {
    for (let off = 0; off < days; off += 7) {
      const startIso = addDaysIso(r.start, off);
      const endIso = addDaysIso(r.start, Math.min(off + 6, days - 1));
      buckets.push({
        kind: 'week',
        startIso,
        endIso,
        label: shortDate(startIso, mode),
        title: rangeLabel({ start: startIso, end: endIso }, mode),
      });
    }
    return buckets;
  }

  const months = calendarMonths(r, mode) ?? calendarMonths(r, 'ad')!;
  const effectiveMode: CalendarMode = calendarMonths(r, mode) ? mode : 'ad';
  const suffix = effectiveMode === 'bs' ? ' BS' : '';
  const multiYear = months[0].year !== months[months.length - 1].year;

  if (months.length > 36) {
    // Beyond three years a point per month would be hundreds of points.
    const byYear = new Map<number, CalendarMonth[]>();
    months.forEach((m) => byYear.set(m.year, (byYear.get(m.year) ?? []).concat(m)));
    byYear.forEach((ms, year) => {
      const [s, e] = clip(ms[0].startIso, ms[ms.length - 1].endIso, r);
      buckets.push({ kind: 'year', startIso: s, endIso: e, label: String(year), title: `${year}${suffix}` });
    });
    return buckets;
  }

  months.forEach((m) => {
    const [s, e] = clip(m.startIso, m.endIso, r);
    const name = effectiveMode === 'bs' ? BS_MONTHS[m.month] : MON[m.month];
    const full = effectiveMode === 'bs' ? BS_MONTHS[m.month] : MON_FULL[m.month];
    buckets.push({
      kind: 'month',
      startIso: s,
      endIso: e,
      label: name + (multiYear ? ` '${String(m.year).slice(2)}` : ''),
      title: `${full} ${m.year}${suffix}`,
    });
  });
  return buckets;
}

/** Index of the bucket holding a day, or -1. Buckets are in order and cover
 * the range without gaps, so a binary search on the start dates finds it. */
export function bucketIndexFor(buckets: Bucket[], iso: string): number {
  let lo = 0;
  let hi = buckets.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (buckets[mid].startIso <= iso) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 && iso <= buckets[found].endIso ? found : -1;
}

// ---- totals

export interface CategoryTotal {
  category: string;
  jobs: number;
  earn: number;
}

function inRange(c: Completion, r: DateRange): boolean {
  return c.date >= r.start && c.date <= r.end;
}

/** Every category the technician has ever finished a job in, with its jobs
 * and earnings inside the range (zero when it has none there), most jobs
 * first. Keeping the zero rows means the list doesn't change shape when the
 * range does. */
export function totalsByCategory(all: Completion[], r: DateRange): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>();
  const lifetime = new Map<string, number>();
  for (const c of all) {
    lifetime.set(c.category, (lifetime.get(c.category) ?? 0) + 1);
    if (!map.has(c.category)) map.set(c.category, { category: c.category, jobs: 0, earn: 0 });
    if (inRange(c, r)) {
      const t = map.get(c.category)!;
      t.jobs += 1;
      t.earn += c.amount;
    }
  }
  return [...map.values()].sort(
    (a, b) => b.jobs - a.jobs || (lifetime.get(b.category) ?? 0) - (lifetime.get(a.category) ?? 0) || a.category.localeCompare(b.category)
  );
}

export interface Scope {
  jobs: number;
  earn: number;
  /** "Laptop Repair", "2 categories", "No jobs". */
  name: string;
}

/** What the two big numbers show: everything in the range, or only the
 * categories that are picked. */
export function scopeOf(totals: CategoryTotal[], selected: string[]): Scope {
  const picked = totals.filter((t) => selected.includes(t.category));
  const used = picked.length ? picked : totals;
  const jobs = used.reduce((s, t) => s + t.jobs, 0);
  const earn = used.reduce((s, t) => s + t.earn, 0);
  let name: string;
  if (picked.length === 1) name = picked[0].category;
  else if (picked.length > 1) name = `${picked.length} categories`;
  else {
    const n = totals.filter((t) => t.jobs > 0).length;
    name = n === 0 ? 'No jobs' : n === 1 ? '1 category' : `${n} categories`;
  }
  return { jobs, earn, name };
}

// ---- chart series

/** Six hues that stay apart, plus grey for everything beyond. */
export const SERIES_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'] as const;
export const OTHER_COLOR = '#9ca3af';

/** A fixed colour per category, ranked by all-time jobs so it never changes
 * when the date range or the selection does. */
export function categoryColors(all: Completion[]): Map<string, string> {
  const counts = new Map<string, number>();
  all.forEach((c) => counts.set(c.category, (counts.get(c.category) ?? 0) + 1));
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out = new Map<string, string>();
  ranked.forEach(([cat], i) => out.set(cat, i < SERIES_PALETTE.length ? SERIES_PALETTE[i] : OTHER_COLOR));
  return out;
}

export interface Series {
  id: string;
  name: string;
  color: string;
  values: number[];
}

/** Jobs per bucket for each category being drawn. Categories beyond the
 * `max` busiest in the range are folded into one grey "Other" line, so the
 * chart never turns into a tangle. */
export function buildSeries(
  all: Completion[],
  buckets: Bucket[],
  categories: string[],
  colors: Map<string, string>,
  max = 6
): Series[] {
  const per = new Map<string, number[]>();
  categories.forEach((c) => per.set(c, new Array(buckets.length).fill(0)));
  for (const c of all) {
    const row = per.get(c.category);
    if (!row) continue;
    const i = bucketIndexFor(buckets, c.date);
    if (i >= 0) row[i] += 1;
  }
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  const sorted = [...per.entries()].sort((a, b) => sum(b[1]) - sum(a[1]) || a[0].localeCompare(b[0]));
  const head = sorted.slice(0, max);
  const tail = sorted.slice(max);
  const out: Series[] = head.map(([cat, values]) => ({ id: cat, name: cat, color: colors.get(cat) ?? OTHER_COLOR, values }));
  if (tail.length) {
    const values = new Array(buckets.length).fill(0);
    tail.forEach(([, v]) => v.forEach((n, i) => (values[i] += n)));
    out.push({ id: '__other__', name: 'Other', color: OTHER_COLOR, values });
  }
  return out;
}

export interface Axis {
  step: number;
  top: number;
  ticks: number[];
}

/** The smallest round step (1, 2, 5, 10, 20, 50 ...) that tops the axis out
 * in at most four intervals, with a little headroom above the highest value. */
export function niceAxis(maxValue: number): Axis {
  const max = Math.max(1, maxValue);
  let step = 1;
  for (let mag = 1; ; mag *= 10) {
    const found = [1, 2, 5].map((k) => k * mag).find((s) => Math.ceil((max * 1.1) / s) <= 4);
    if (found) {
      step = found;
      break;
    }
  }
  const intervals = Math.ceil((max * 1.1) / step);
  const ticks = Array.from({ length: intervals + 1 }, (_, i) => i * step);
  return { step, top: intervals * step, ticks };
}
