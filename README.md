# Jageer Nepal

Jageer Nepal is a services marketplace for customers in Nepal who need IT or home-technician work, and the local shops that coordinate that work. It also supports product sales. The app runs on iOS and Android, with a web build.

The reseller is the product's main business user: beyond receiving service requests, resellers can manage customers and ledgers, assign technicians, handle inventory, track finance, and sell products. Client booking and shopping feed into that reseller-led operation.

## Product Roles

The app shares authentication and profiles across five roles:

- **Client:** discovers services and products, creates service requests, and tracks work.
- **Technician:** receives assigned jobs, works them, and records job details and supporting photos.
- **Reseller:** manages service requests, technicians, customers, sales, inventory, and finance for a local shop.
- **Wholesaler:** supplies products to resellers.
- **Admin:** oversees the platform, catalog, verification, and support.

## Main Workflows

A client can create a service request or buy a product. A reseller can quote on a request, approve and assign work to a technician, and progress it through the service lifecycle:

`pending -> quoted -> approved -> assigned -> in_progress -> resolved`

A request can also be cancelled. Payments support cash, which a reseller marks as paid, and online payment through Fonepay QR. The product also includes saved contacts for previously used resellers or technicians.

Reseller tools include customer records and ledgers, technician assignment and employment, inventory, quick payments, transactions, bank accounts, statement import, quotations, and rewards. Exact capabilities vary by role and route.

## Technology

- Expo SDK 56 and React Native 0.85
- Expo Router for file-based navigation
- NativeWind and Tailwind CSS for shared styling
- Supabase for Postgres-backed data, authentication, and row-level security (RLS)
- Supabase Edge Functions for Fonepay payment flows
- TanStack Query with a thin Supabase hook layer for server data
- Zustand for client-side state
- TypeScript

The app uses one shared design system across iOS, Android, and web. Signed-in roles use a desktop sidebar shell at wider web sizes; pre-login web screens are phone-width. Follow the existing conventions in `DESIGN.md` and `PRODUCT.md` when changing UI or product behavior. In particular, RLS is the actual data-access boundary; client-side role guards are for navigation and UX, not security.

## Repository Guide

- `app/`: Expo Router screens, layouts, and role route groups such as `(client)`, `(reseller)`, `(technician)`, `(wholesaler)`, and `(admin)`.
- `lib/`: shared UI components, hooks, providers, constants, Supabase client, and utilities.
- `types/`: generated or shared TypeScript types, including database types.
- `supabase/`: database migrations and Edge Functions.
- `assets/`: app branding and service category illustrations.
- `finance-port/`: finance schema, posting notes, and finance specification.
- `PRODUCT.md`: product goals, roles, constraints, and existing capabilities.
- `DESIGN.md`: established visual and component system.
- `AGENTS.md`: repository-specific instructions for coding agents.

## Local Development

Prerequisites: Node.js/npm and the platform tools required by the target (Android Studio/Android SDK for Android; macOS with Xcode for native iOS builds). This project is private and uses a real Supabase backend.

1. Install dependencies from the lockfile:

   ```sh
   npm ci
   ```

2. Create a local `.env` file with the Supabase project URL and anon key:

   ```dotenv
   EXPO_PUBLIC_SUPABASE_URL=your-supabase-project-url
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
   ```

   The app checks for both values at startup. Do not commit credentials or put service-role keys in the client app.

3. Start the development server or run a platform script:

   ```sh
   npm start
   npm run web
   npm run android
   npm run ios
   ```

   `npm run build` exports the web build. Native iOS and Android runs require their respective development environments; a development build may also be needed for native modules. Check the Expo SDK 56 documentation and the repository instructions before changing Expo-specific code or configuration.

## Configuration and Security Notes

Supabase configuration is read from `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `lib/supabase.ts`. Authentication uses the shared secure-storage adapter and the `jageer-nepal-auth-token` storage key. Use the project’s RLS policies for authorization and scope database access; never treat a hidden screen or client-side role check as permission enforcement.

The Expo app configuration is in `app.json`. Native permissions cover features including photos, location, contacts, biometrics, and audio; review permission copy and platform behavior when changing related features.

## Continuing on Another Device

The project files live in the local workspace, so they do not move to another device automatically. To continue there:

1. Make sure the latest project changes are available through the repository's Git remote or another secure transfer method.
2. On the other device, open the project, install dependencies with `npm ci`, and configure its own local `.env` values.
3. Sign into VS Code with the same account and check whether this chat is available. If it is not, use the session handoff below as context for a new chat.

Committed changes can be transferred by pushing and pulling through the configured remote. Uncommitted changes need to be transferred separately; they are not included in a normal push until committed. Keep `.env` and all credentials out of Git and chat.

## Current Session Handoff

**Date:** 2026-09-30

This session asked for a summary to continue work from another device, then requested a detailed README. No specific feature, bug, implementation change, or test run was recorded before this document was created. The confirmed working context is the Jageer Nepal app described above. To resume feature work, identify the desired behavior or issue and its relevant role/screen; this chat does not establish a narrower in-progress coding task.
