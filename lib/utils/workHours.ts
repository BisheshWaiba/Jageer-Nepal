// lib/utils/workHours.ts

/** Why a work-hours range ('HH:MM' 24-hour) can't be saved, or null if it's
 * fine. Shifts are same-day (e.g. 09:00-17:00), so the end must come after
 * the start - equal or reversed times used to be accepted silently. */
export function workHoursIssue(start: string, end: string): string | null {
  if (!start || !end) return 'Pick both a start and an end time.';
  if (end <= start) return 'The end time must be later than the start time.';
  return null;
}
