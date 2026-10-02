---
version: 1
slug: "app-reseller-team-activity-tsx"
primary_target: "app/(reseller)/team-activity.tsx"
related_targets:
  - "lib/components/TeamActivity.tsx"
  - "app/(reseller)/employees.tsx"
  - "app/(reseller)/employee/[id].tsx"
  - "app/(reseller)/dashboard.tsx"
---

# Team hub: Activity + People (reseller)

**Scope & mode:** Operate. Reseller-only. Replaces today's split between Team Activity, Technical Employees, the employee page and the dashboard's employee list.

**Audience & job:** A reseller between calls, on phone or desktop sidebar. First question: who is free, who is stuck, what needs action now. Second: manage the roster (invite, add, edit, remove).

**Chosen direction:** "Live roster, attention first." Existing world (DESIGN.md) is kept; no new visual world.
- One Team destination with an **Activity | People** switch.- **Activity:** optional Needs-attention strip (unaccepted offer over 15 min, hold / hold requested, on-shift technician with stale location; each with one action: call or open job; hidden when empty) -> Team board as one grouped list, one row per person (avatar, name, soft-tint state chip: On a job / Offer pending / Free / Off shift; current job in one line; location age; call, and Assign job when Free), sorted attention, working, free, off shift -> **Today | History** jobs. Today groups Waiting / In progress / Done today; History filters by technician and groups by day. Counts become one filter line ("2 working · 1 waiting · 3 free") that filters the board.
- **Job row:** compact (title, technician, status chip, one time line). Progress bar and Assigned/Accepted/Time stats only for active jobs; finished collapses to "Done · 1h 20m".
- **People:** the roster, management only. Two creation actions (Invite, Add) in a header action, not big cards. Rows show name, job title, shift, account state; hand-added people are marked "No app account, can't be tracked" and appear here only.
- **Employee page:** header carries state chip, location, call, Assign job (opens existing sheet; Assign card removed). Activity | Details switch; save bar only on Details.
- **Dashboard:** "Team now" card (counts, avatar stack with state dots, one "Open team" button). Remove action leaves the dashboard.

**Untouched:** data hooks and schema, invite / add / leave-approval flows, form drafts, AssignJobSheet, work-history content, request detail.

**Anti-goals:** no new accent colours (purple, teal, emerald avatars become blue/grey), no card shadows, no gradients, no emoji, no solid-fill status chips. One location-privacy note, shown once.

**States:** no employees; employees but no jobs; location missing; off shift; hand-added person; many employees (grouped list, not a card grid).

**Confirmed by user:** one Team hub with Activity | People switch; "needs attention" = offer unaccepted over 15 min, any hold / hold requested, or stale location while on shift.

**Unresolved decisions:** final tab/route name for the hub.
