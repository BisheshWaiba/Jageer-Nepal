// lib/utils/localDate.ts

/** Today as 'YYYY-MM-DD' in the device's own time zone. `toISOString()`
 * is UTC, which in Nepal (UTC+5:45) still reads as yesterday until 05:45 -
 * so anything entered just after midnight got the previous day's date. */
export function localTodayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** True for a 'YYYY-MM-DD' date before today (local time). */
export function isPastDate(isoDate: string): boolean {
  return !!isoDate && isoDate < localTodayIso();
}
