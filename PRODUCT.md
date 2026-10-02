# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

Ships as a real Expo/React Native app to iOS and Android, plus a web build via react-native-web (letterboxed to a phone-width column pre-login; each signed-in role gets a desktop sidebar shell above a set width breakpoint). "Adaptive" here is a mechanical note, not a design instruction: the product does **not** switch between HIG and Material 3 components per OS. It uses one custom, brand-consistent design system (NativeWind/Tailwind, blue/white) uniformly across iOS, Android, and web. Baseline native guarantees still apply on-device (safe-area insets, minimum touch targets, system back/gesture behavior), but per-OS visual divergence is not part of this product's identity — introducing one into a single screen would read as inconsistent against every other tab already built in the shared custom system.

## Users

Five roles, one shared auth/profile system (`profiles` table with a `role` column):

- **Client** — books IT/home-technician services and buys products from resellers. Primary consumer-facing role.
- **Technician** — gets assigned jobs by a reseller, works them, files job cards/chalan photos.
- **Reseller** — the core business role: runs their own local IT/service shop through the app — takes client requests, assigns technicians, manages a customer directory + ledger, sells products, tracks Finance (payments, expenses, bank accounts, quotations).
- **Wholesaler** — supplies products in bulk to resellers.
- **Admin** — platform oversight (catalog, verification, support).

## Product Purpose

Jageer Nepal ("One platform. Every IT need.") is a services marketplace connecting Nepali customers who need IT and home-technician work done with local resellers/shops who run the job. A client posts a request or buys a product; a reseller quotes, assigns a technician, and gets paid — all inside the same app.

## Positioning

The differentiator is the **reseller/business layer**, not the client-facing booking flow. A generic local-services marketplace stops at "match a customer to a provider." Jageer Nepal's real product is giving small local IT/service shops (resellers) the operating system to run their business on: customer directory + ledger, technician assignment and employment, inventory, a Finance suite (quick payment, transactions, bank accounts, statement import, quotations with the reseller's own letterhead), and reward points — with client booking as the front door that feeds that system, not the whole product.

## Operating Context

- Real Supabase backend (Postgres + RLS, Edge Functions for Fonepay payments) — every role's data is scoped by RLS policy, not just client-side checks.
- Client requests flow through a status pipeline: pending → quoted → approved → assigned → in_progress → resolved (or cancelled).
- A client can also save/bookmark a reseller or technician they've worked with ("Saved Contacts") for one-tap call/message later.
- Categories are a real, curated set of ~35 IT and home-technician services (Website & App Design, Cybersecurity, Cloud Solutions, CCTV, Computer/Laptop Repair, AC/appliance/electrical repair, door locks, WiFi/networking, solar, plumbing, etc.), each with a custom illustrated icon.
- Payments: cash (marked paid manually by the reseller) or online via Fonepay QR.

## Team Management (reseller ↔ technician employment)

- A technician can be employed by a reseller. The reseller tracks their employees: jobs, assigned and accepted times, time taken, job progress, and live location (the technician shares location via `useShareLiveLocation`). Surfaces: reseller Team Activity, Employees, and per-technician work history.
- Leaving is two-sided: a technician requests to leave (optional reason) and the employment ends only when the employer approves; the employer can reject. The employer gets a popup and a dashboard card, and the technician is told the outcome. This is enforced in the database guard trigger (migration 0081), not only in the UI.

## Capabilities and Constraints

- Tech stack: Expo (SDK 56) / React Native 0.85, expo-router (file-based routing, per-role route groups), NativeWind (Tailwind for RN), Zustand for client state, @tanstack/react-query + a thin Supabase hook layer for data.
- Brand color: a single blue (`#3b82f6` / `#2563eb` family) across the whole app — note the codebase overrides Tailwind's `orange` palette to these blue values, so `bg-orange-500` etc. in existing code renders blue; don't be misled by the class names.
- Every role's shared components (`PortalHeaderBar`, `TabIcon`, `PersonAvatar`, `WebSidebarShell`, and — relevant here — `ProfileScreen`) are literally the same component instance reused per role via `RoleGuard`-wrapped route groups (`app/(client)`, `app/(technician)`, `app/(reseller)`, `app/(wholesaler)`, `app/(admin)`), not five separate implementations. A profile-tab change to the shared component affects all five roles at once unless deliberately branched by `profile.role`.
- The existing Profile tab (`lib/components/ProfileScreen.tsx`) already covers: avatar upload, editable name/address/phone, biometric-unlock toggle, a Rewards entry card (all roles except admin), technician-only availability + skills picker, reseller/technician skills picker, a Report an Issue / Support form, and Sign Out.
- Biometric fingerprint sign-in exists as a separate, deliberate feature (stores email+password in `expo-secure-store`) — distinct from the biometric app-lock toggle already on the Profile tab.

## Evidence on Hand

- Real brand assets exist: `assets/jageer-logo.png` (3D figurine logo mark) and a full illustrated category-icon set under `assets/categories/`.
- No customer testimonials, press, case studies, or usage numbers are on hand — do not fabricate any on any surface.

## Product Principles

1. **One design system, every platform.** Brand consistency across iOS/Android/web outranks per-OS native purity; new work extends the existing custom system rather than introducing Material/HIG divergence.
2. **The reseller is the real customer.** Client-facing surfaces should feel considered, but business-critical depth (ledger, Finance, assignment) belongs to the reseller/technician side — don't over-invest polish on the consumer shell at the business layer's expense.
3. **RLS is the real access control.** Any client-side role gate (`RoleGuard`) is UX convenience, never the security boundary.
4. **Real data over invented data.** No fabricated stats, testimonials, or numbers anywhere in the product — Nepal-specific facts (phone formats, NPR currency, Fonepay) are real constraints, not decoration.

## Accessibility & Inclusion

No formal accessibility standard has been confirmed as a requirement yet; treat native touch-target minimums (44pt iOS / 48dp Android) and legible type as the working baseline until told otherwise.
