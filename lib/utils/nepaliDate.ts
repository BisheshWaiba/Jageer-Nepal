// lib/utils/nepaliDate.ts
import NepaliDate, { dateConfigMap } from 'nepali-date-converter';
import { localTodayIso } from './localDate';

// Same order as NepaliDate's 0-based month index and the dateConfigMap keys.
export const BS_MONTHS = [
  'Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Aswin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
];

export interface BsDate {
  year: number;
  month: number; // 0-based, matches BS_MONTHS
  date: number;
}

// Nepal's official fiscal year runs Shrawan 1 - Ashad end (BS_MONTHS index 3
// through the end of index 2 the following year), not Baisakh-Chaitra - used
// for the "083/84" style suffix on a quotation number. Verified against a
// real quotation: 2083-05 (Bhadra, index 4) -> "083/84".
export function nepaliFiscalYearSuffix(bsYear: number, bsMonth: number): string {
  const startYear = bsMonth >= 3 ? bsYear : bsYear - 1;
  return `${String(startYear).slice(-3)}/${String(startYear + 1).slice(-2)}`;
}

/** Bikram Sambat label for an AD date string ('YYYY-MM-DD'), e.g. "Falgun 27, 2082 BS".
 * Nepal runs on the BS calendar day-to-day, so every date shown or picked in the app
 * should carry its BS equivalent alongside the AD one - not just the Gregorian date. */
export function toBsLabel(adDateStr: string): string {
  const [y, m, d] = adDateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  try {
    const bs = new NepaliDate(new Date(y, m - 1, d));
    return `${bs.format('MMMM DD, YYYY')} BS`;
  } catch {
    return '';
  }
}

/** Compact BS label for a chart axis, e.g. "Bhadra 5" - takes a JS Date (or
 * epoch ms) directly rather than a string, so it reads local
 * year/month/date the same way every chart bucket is already built (going
 * through an ISO string first would round-trip via UTC and could land on
 * the wrong day for Nepal's +5:45 offset). */
export function toBsDayChartLabel(date: Date | number): string {
  try {
    const bs = new NepaliDate(new Date(date)).getBS();
    return `${BS_MONTHS[bs.month]} ${bs.date}`;
  } catch {
    return '';
  }
}

/** Compact BS month label for a chart axis, e.g. "Bhadra" - the BS month
 * that overlaps the given AD date (typically a month-bucket's start), for
 * charts bucketed by AD month. An AD month doesn't align to one BS month,
 * so this is which BS month that bucket *starts* in, not an exact range. */
export function toBsMonthChartLabel(date: Date | number): string {
  try {
    const bs = new NepaliDate(new Date(date)).getBS();
    return BS_MONTHS[bs.month];
  } catch {
    return '';
  }
}

/** BS label for a plain 'YYYY-MM-DD' date OR a full ISO timestamp
 * ('YYYY-MM-DDTHH:mm:ss.sssZ') - transaction history rows carry
 * `created_at` timestamps rather than bare dates, and Nepal runs on the BS
 * calendar day-to-day, so every history row should show its date this way
 * by default rather than the Gregorian one. Falls back to the plain AD date
 * if BS conversion fails, so a row never ends up with no date at all. */
export function toBsHistoryLabel(dateStr: string): string {
  const dateOnly = dateStr.slice(0, 10);
  return toBsLabel(dateOnly) || new Date(dateStr).toLocaleDateString();
}

/** English (Gregorian) label for an AD date string, e.g. "Wed, Feb 18, 2026". */
export function toAdLabel(adDateStr: string): string {
  const [y, m, d] = adDateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** AD date string -> its BS calendar fields, for driving a BS calendar grid.
 * Null if the string is malformed or falls outside the library's supported
 * BS 2000-2090 range (roughly AD 1943-2033) - NepaliDate throws rather than
 * clamping, and this must never crash whatever's rendering the date. */
export function adStringToBs(adDateStr: string): BsDate | null {
  const [y, m, d] = adDateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  try {
    const bs = new NepaliDate(new Date(y, m - 1, d)).getBS();
    return { year: bs.year, month: bs.month, date: bs.date };
  } catch {
    return null;
  }
}

/** Same as adStringToBs, but falls back to today's BS date instead of null
 * so callers that need a definite grid position (e.g. a picker's initial
 * state) can never end up with an invalid year/month. */
export function adStringToBsOrToday(adDateStr: string): BsDate {
  return adStringToBs(adDateStr) ?? adStringToBs(localTodayIso())!;
}

/** BS calendar fields -> the 'YYYY-MM-DD' AD string every date is stored as. */
export function bsToAdString(year: number, month: number, date: number): string {
  const js = new NepaliDate(year, month, date).toJsDate();
  const yy = js.getFullYear();
  const mm = String(js.getMonth() + 1).padStart(2, '0');
  const dd = String(js.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** How many days a given BS year/month has - needed to lay out the grid. */
export function bsDaysInMonth(year: number, month: number): number {
  const cfg = (dateConfigMap as unknown as Record<string, Record<string, number>>)[String(year)];
  return cfg?.[BS_MONTHS[month]] ?? 30;
}

/** Weekday (0=Sunday...6=Saturday) of the 1st of a given BS year/month - the
 * leading blank offset for the grid. */
export function bsWeekdayOfFirst(year: number, month: number): number {
  try {
    return new NepaliDate(year, month, 1).getDay();
  } catch {
    return 0;
  }
}
