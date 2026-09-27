// lib/utils/workHours.ts

/** Why a work-hours range ('HH:MM' 24-hour) can't be saved, or null if it's
 * fine. An end earlier than the start is a legitimate overnight shift (e.g.
 * 22:00-06:00, which useTechnicianRanking's isWithinWorkHours wraps around
 * midnight), so only an empty or zero-length range is rejected. */
export function workHoursIssue(start: string, end: string): string | null {
  if (!start || !end) return 'Pick both a start and an end time.';
  if (end === start) return 'The start and end times are the same - pick a real shift.';
  return null;
}
