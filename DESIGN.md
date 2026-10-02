---
name: Jageer Nepal
description: A services marketplace connecting Nepali clients with local IT/home-technician resellers and their technicians
colors:
  trusted-blue: "#3b82f6"
  trusted-blue-strong: "#2563eb"
  trusted-blue-deep: "#1d4ed8"
  trusted-blue-tint: "#dbeafe"
  trusted-blue-wash: "#eff6ff"
  neutral-ink: "#111827"
  neutral-body: "#4b5563"
  neutral-caption: "#6b7280"
  neutral-placeholder: "#9ca3af"
  neutral-border: "#e5e7eb"
  neutral-hairline: "#f3f4f6"
  neutral-canvas: "#f9fafb"
  neutral-surface: "#ffffff"
  status-success-bg: "#f0fdf4"
  status-success-text: "#15803d"
  status-warning-bg: "#fffbeb"
  status-warning-text: "#d97706"
  status-danger-bg: "#fef2f2"
  status-danger-text: "#dc2626"
typography:
  heading:
    fontFamily: "system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif"
    fontWeight: 800
    lineHeight: 1.2
  title:
    fontFamily: "system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif"
    fontWeight: 400
    fontSize: "14px"
    lineHeight: 1.4
  label:
    fontFamily: "system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif"
    fontWeight: 700
    fontSize: "10-11px"
    letterSpacing: "0.05em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.trusted-blue-strong}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-body}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  card:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-ink}"
    rounded: "{rounded.lg}"
    padding: "16px 20px"
---

# Design System: Jageer Nepal

## Overview

**Creative North Star: "The Trusted Toolbelt"**

Jageer Nepal reads as equipment you rely on, not a storefront you browse: confident, no-nonsense, built for getting a job done. One blue carries the whole brand — no secondary or tertiary accent competes with it — set against white surfaces and a soft gray canvas, separated by hairline borders rather than shadows. Type leans bold and heavy at every level except body copy; there is no ornamental serif, no display face, no gradient, nothing decorative standing between the visitor and the task. The system is the same across every role (client, technician, reseller, wholesaler, admin) and every platform it ships to (iOS, Android, web) — one shared toolbelt, not five branded apps wearing the same logo.

Confirmed rejections: no gradients anywhere in the product; no glassmorphism/blur-as-decoration; no colored side-borders on cards; no emoji standing in for icons (Ionicons is the one icon vocabulary).

**Key Characteristics:**
- One brand blue, no competing accent
- Generous, consistent rounding (16px cards, full-round pills/avatars) — never a sharp corner
- Flat-and-bordered by default; shadow is reserved for things that float above the page
- Bold/extrabold type carries hierarchy; body copy stays regular weight
- Soft-tint semantic badges (light background, saturated text) for every status

## Colors

The palette is deliberately narrow: one blue role, a gray neutral scale, and three soft semantic pairs for status — nothing else competes for attention.

### Primary
- **Trusted Blue** (`#3b82f6`): the one brand accent — primary buttons, active tab/nav state, selected chips, links, focus rings. Carries every role's identity band (`ROLE_ACCENT`), so it means "this is you" as much as "tap this."
- **Trusted Blue Strong** (`#2563eb`): the pressed/solid form of the accent — filled primary buttons, icon accents inside a light-blue chip.
- **Trusted Blue Deep** (`#1d4ed8`): highest-contrast blue — link text on white, small bold accents, avatar-initial text on a blue-tint background.
- **Trusted Blue Tint** (`#dbeafe`) / **Trusted Blue Wash** (`#eff6ff`): light blue fields behind an icon chip or avatar-initials circle — never a large surface.

### Neutral
- **Neutral Ink** (`#111827`): primary text and headings.
- **Neutral Body** (`#4b5563`): secondary text with more presence than a caption (e.g. a header's account name).
- **Neutral Caption** (`#6b7280`): captions, helper text, sub-labels under a heading.
- **Neutral Placeholder** (`#9ca3af`): placeholder text, disabled/inactive icons, chevrons.
- **Neutral Border** (`#e5e7eb`): the standard 1px card/row border.
- **Neutral Hairline** (`#f3f4f6`): the softer divider between rows inside one grouped container, and between a header bar and its content.
- **Neutral Canvas** (`#f9fafb`): the screen background every surface sits on.
- **Neutral Surface** (`#ffffff`): every card, row, and input field.

### Status (semantic, always a soft-tint pair)
- **Success** (`#f0fdf4` bg / `#15803d` text): resolved, paid, available.
- **Warning** (`#fffbeb` bg / `#d97706` text): pending, quote sent, awaiting action.
- **Danger** (`#fef2f2` bg / `#dc2626` text): cancelled, destructive action text (Sign Out uses this red on a bordered white button, never a filled red button).

### Named Rules
**The One Accent Rule.** Trusted Blue is the only saturated color that carries UI meaning (action, selection, identity). Status pairs are the sole exception, and they are always soft-tint, never solid-fill.

**The Soft Badge Rule.** A status is always a light-tint background with saturated text of the same hue family (e.g. `#f0fdf4` / `#15803d`), rounded full, never a solid-fill chip.

**The Chart Palette Exception.** A chart that has to tell several categories apart (the technician dashboard's jobs-by-category lines) uses a fixed set of six hues - `#2a78d6`, `#eb6834`, `#1baf7a`, `#eda100`, `#e87ba4`, `#008300` - and grey for any beyond them, handed out by a category's all-time rank so its colour never moves when the date range changes. The hue only ever identifies a category; it never means status or action.

## Typography

**Body/UI Font:** System sans (`-apple-system, Roboto, Helvetica, Arial, sans-serif` — the platform default, no custom face is loaded)

**Character:** One workhorse sans carries everything, headings included — there is no display/body pairing. Weight, not a second family, is what creates hierarchy: extrabold headings, bold labels and section titles, regular-weight body and helper text.

### Hierarchy
- **Heading** (extrabold 800, 20–26px, 1.2 line-height): screen titles, "Welcome back" greetings, empty-state headlines.
- **Title** (bold 700, 14–17px, 1.3): card/section titles, identity-band name.
- **Body** (regular 400, 13–14px, 1.4): descriptions, field values, helper text.
- **Label** (bold 700, 10–11px, uppercase, 0.05em tracking): status badges, section headers inside a grouped list ("WORK", "ACCOUNT"), tab labels.

### Named Rules
**The Weight-Not-Family Rule.** Never introduce a second font family for hierarchy or "brand feel." A heavier weight of the same system sans is always the right move.

## Layout

Every screen sits on the Neutral Canvas with 20–24px horizontal padding. Cards and grouped lists stack vertically with 16–20px gaps between sections; a group's own rows sit flush with no gap, separated only by a 1px hairline. On web, pre-login content is letterboxed to a 640px phone-width column; signed-in, wide viewports (≥768px) get a persistent 240px sidebar (`WebSidebarShell`) beside a content column capped at 1120px — mobile itself is never redesigned for web, web just adds a frame around the same screens.

## Elevation & Depth

The system is flat-and-bordered at rest: ordinary cards and rows use a 1px `Neutral Border` for separation, never a shadow. Shadow is reserved for elements that genuinely float above the page's own stacking order — a bottom cart bar, the floating AI-assistant bubble, a dropdown/sheet, or (as of this build) a scrolling panel pinned beneath a fixed identity header. When shadow does appear it is soft: real blur and a real offset, never a hard block shadow.

### Shadow Vocabulary
- **Floating surface** (`shadowOpacity: 0.06–0.18, shadowRadius: 6–10, offset {0, -2 to 2}`): bottom bars, floating bubbles, and panels stacked above/below a fixed sibling.

### Named Rules
**The Border-Not-Shadow Rule.** A card or list row is separated from its neighbors by a 1px border, never a shadow. Shadow is earned only by an element that is actually stacked above other content, not by "wanting to look important."

## Shapes

Rounding is generous and consistent: 16px on cards and grouped-list containers, 12px on buttons/inputs/icon chips, full-round on avatars, pills, and status badges. Nothing in the system uses a sharp (0px) corner. Borders are always 1px (1.5px on form inputs and the login/register fields), solid, in `Neutral Border` or `Neutral Hairline`.

## Components

The system's components read as confident and flat: solid or bordered, generously rounded, no gradients or inner glows anywhere.

### Buttons
- **Shape:** 12px radius (16px on a few full-width CTAs like Sign Out and card actions).
- **Primary:** `Trusted Blue Strong` fill, white text, bold.
- **Secondary/Ghost:** white fill, `Neutral Border` 1px border, `Neutral Body` text.
- **Destructive:** white fill, `#fecaca`-family border, `Danger` red text — never a solid red fill.

### Chips / Badges
- **Status badge:** soft-tint pair (see Colors → Status), full-round, uppercase bold label text.
- **Selected/filter chip:** `Trusted Blue Strong` fill, white text, full-round, with a small "×" to remove.

### Cards / Containers
- **Corner style:** 16px.
- **Background:** `Neutral Surface` on `Neutral Canvas`.
- **Shadow strategy:** none at rest (see Elevation & Depth); border only.
- **Border:** 1px `Neutral Border`.
- **Internal padding:** 16–20px.

### Grouped Lists (signature component, introduced in the Profile redesign)
A single bordered, rounded container holding multiple rows of an icon chip + label/caption + trailing accessory (switch, chevron, or value), separated by 1px `Neutral Hairline` dividers between rows and none after the last. This is the system's answer to "several related settings/actions in sequence" — it replaces a stack of individually-bordered cards, which reads as repetitive at three or more items. Use a grouped list whenever three or more sibling toggles/links/rows would otherwise each get their own card.

### Inputs / Fields
- **Style:** white fill, 1px–1.5px `Neutral Border`, 8–12px radius.
- **Focus/Error:** not yet distinctly themed in code — treat as an open implementation gap rather than an invariant.

### Navigation
- Bottom tab bar (mobile) / left sidebar (wide web): `Trusted Blue` for the active icon+label, `Neutral Placeholder` gray for inactive, Ionicons throughout (outline glyph inactive, filled glyph active).

## Motion

Motion here is quiet and functional - it confirms that something happened or shows where something went, and never decorates. It is all time-based (no bounce), short, and lives in `lib/components/Motion.tsx` so every screen moves the same way.

- **Arrive** (`Rise`, `Appear`): a block fades in while rising a little, 240ms, with siblings arriving 40ms apart (never more than six steps, so a long list isn't slow). A card that appears later by realtime does the same.
- **Leave and reflow:** a block fades out in 160ms, and the blocks around it glide into the gap over 220ms instead of jumping.
- **Press** (`PressScale`): a tappable button shrinks to 0.97 (a whole card, 0.985) in 90ms and returns in 150ms, so a tap is felt before anything else happens.
- **Loading** (`Pulse`, `JobCardSkeleton`): grey placeholder shapes breathe while data is on its way, so a screen never claims "nothing here" before it knows.
- **Reduce motion:** every animation follows the system setting - it is skipped and the content simply appears.

### Named Rules
**The Presets-Only Rule.** Use Reanimated's built-in entering / exiting / layout presets (`FadeInDown`, `FadeIn`, `FadeOut`, `LinearTransition`) and don't customise them with keyframes, starting values or easings. On the web build a custom one leaves the view stuck at `position: absolute`, so it stops taking up room and everything below slides underneath it.

## Do's and Don'ts

### Do:
- **Do** use Trusted Blue for the one thing on a screen that means "act" or "this is selected" — not for decoration.
- **Do** separate cards, rows, and sections with borders/hairlines, not shadows.
- **Do** reach for a grouped list (not repeated cards) once three or more simple rows would otherwise stack.
- **Do** carry a soft-tint status pair whenever the product needs to say pending/success/danger.
- **Do** draw icons from Ionicons only, one consistent outline/filled pairing for inactive/active state.

### Don't:
- **Don't** introduce a second accent color; status pairs are the only sanctioned exception, and they stay soft-tint.
- **Don't** use emoji as an icon substitute anywhere in the UI (copy-level emoji in a rare confirmational sentence is the only tolerated use, and even that should be phased out in favor of an icon + plain text).
- **Don't** add a shadow to an element that isn't actually floating above other content.
- **Don't** introduce a display/serif font for "brand feel" — hierarchy comes from weight on the one system sans.
- **Don't** use a solid-fill red (or any solid semantic color) for a status badge or destructive button; keep destructive actions as bordered white with red text.
