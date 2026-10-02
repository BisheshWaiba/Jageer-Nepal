// lib/utils/teamStatus.ts
// What each employee is doing right now, and which things the reseller has to
// act on. Pure functions over the data useTeamJobs / useTeamLocations return,
// so the Team board, the employee page and the dashboard all agree.
import type { TeamJob } from '../hooks/useTeamActivity';
import type { Profile, TechnicianEmployment, TechnicianLocation } from '../../types/database.types';

/** An offer nobody has accepted for this long needs a nudge. */
export const STUCK_OFFER_MS = 15 * 60_000;
/** A position older than this is "last seen", not "here now". */
export const LOCATION_FRESH_MS = 10 * 60_000;

export type MemberState = 'working' | 'offer' | 'free' | 'off';

export const STATE_LABEL: Record<MemberState, string> = {
  working: 'On a job',
  offer: 'Offer pending',
  free: 'Free',
  off: 'Off shift',
};

export type Attention = {
  key: string;
  kind: 'offer' | 'hold' | 'location';
  technicianId: string;
  title: string;
  detail: string;
  /** Opens this job when the item is about one. */
  requestId?: string;
};

export type Member = {
  employment: TechnicianEmployment;
  profile: Profile;
  state: MemberState;
  onShift: boolean;
  current?: TeamJob;
  offered?: TeamJob;
  loc?: TechnicianLocation;
  attention: Attention[];
};

function minutesOf(time: string | null | undefined, fallback: number) {
  if (!time) return fallback;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Is `now` inside their daily work hours? Handles shifts that cross midnight. */
export function isOnShift(e: Pick<TechnicianEmployment, 'work_start_time' | 'work_end_time'>, now = Date.now()) {
  const d = new Date(now);
  const at = d.getHours() * 60 + d.getMinutes();
  const start = minutesOf(e.work_start_time, 9 * 60);
  const end = minutesOf(e.work_end_time, 17 * 60);
  return start <= end ? at >= start && at < end : at >= start || at < end;
}

export function locationIsFresh(loc: TechnicianLocation | undefined, now = Date.now()) {
  return !!loc && now - new Date(loc.updated_at).getTime() < LOCATION_FRESH_MS;
}

export function buildMember(
  employment: TechnicianEmployment,
  profile: Profile,
  jobs: TeamJob[],
  loc: TechnicianLocation | undefined,
  now = Date.now()
): Member {
  const mine = jobs.filter((j) => j.request.technician_id === profile.id);
  const current = mine.find((j) => j.request.status === 'in_progress');
  const offered = mine.find((j) => j.request.status === 'assigned');
  const onShift = isOnShift(employment, now);
  const state: MemberState = current ? 'working' : offered ? 'offer' : onShift ? 'free' : 'off';

  const name = profile.full_name ?? 'Technician';
  const attention: Attention[] = [];
  for (const j of mine) {
    const r = j.request;
    if (r.status === 'assigned') {
      const waited = now - new Date(r.assigned_at ?? r.created_at).getTime();
      if (waited >= STUCK_OFFER_MS) {
        attention.push({
          key: `offer:${r.id}`,
          kind: 'offer',
          technicianId: profile.id,
          requestId: r.id,
          title: `${name} hasn't accepted ${r.issue_type}`,
          detail: `Waiting ${Math.floor(waited / 60_000)} min`,
        });
      }
    }
    if (r.status !== 'resolved' && r.hold_status !== 'none') {
      attention.push({
        key: `hold:${r.id}`,
        kind: 'hold',
        technicianId: profile.id,
        requestId: r.id,
        title: `${r.issue_type} ${r.hold_status === 'on_hold' ? 'is on hold' : 'has a hold request'}`,
        detail: [name, r.hold_note].filter(Boolean).join(' · '),
      });
    }
  }
  if (onShift && !locationIsFresh(loc, now)) {
    attention.push({
      key: `loc:${profile.id}`,
      kind: 'location',
      technicianId: profile.id,
      title: `${name}'s location isn't coming in`,
      detail: loc ? 'On shift, last position is out of date' : 'On shift, no position shared yet',
    });
  }

  return { employment, profile, state, onShift, current, offered, loc, attention };
}

const ORDER: Record<MemberState, number> = { working: 0, offer: 1, free: 2, off: 3 };

/** Needs-attention people first, then working, offer pending, free, off shift. */
export function sortMembers(members: Member[]) {
  return [...members].sort(
    (a, b) =>
      Number(b.attention.length > 0) - Number(a.attention.length > 0) ||
      ORDER[a.state] - ORDER[b.state] ||
      (a.profile.full_name ?? '').localeCompare(b.profile.full_name ?? '')
  );
}
