# Aidha

AI-assisted task/reminder capture. Type a task or event in plain language, an LLM
(Claude Haiku) parses it into structured data, you review/confirm, and it's saved.

This build covers the input -> parse -> confirm -> save pipeline, plus "leaving
by" departure reminders (geocode the task's location, estimate travel time,
schedule a local notification). Recurring-task scheduling and downtime
detection are not implemented yet.

## Stack

- **App:** Expo (managed, TypeScript), React Navigation (bottom tabs)
- **Backend:** Supabase (Postgres + Auth + Edge Functions)
- **LLM:** Anthropic Claude (`claude-haiku-4-5-20251001`), called server-side only
- **Validation:** Zod, both in the Edge Function

## Project layout

```
aidha/
  App.tsx                     entry point: auth gate + tab navigator
  src/
    lib/
      supabase.ts              Supabase client (reads EXPO_PUBLIC_* env vars)
      AuthContext.tsx           session state, sign in/up/out
      geocoding.ts              wraps the geocode Edge Function
      travelTime.ts             wraps the travel-time Edge Function
      locationPermission.ts    expo-location foreground permission + position
      notifications.ts          expo-notifications schedule/cancel
      leavingBy.ts              computeLeavingBy pure function (unit tested)
      scheduleDeparture.ts      updateDepartureForTask orchestration
      constants.ts              DEPARTURE_BUFFER_MINUTES
    screens/
      AuthScreen.tsx            email/password sign in/up
      NewTaskScreen.tsx          input -> parse-task -> TaskCard -> Save
      TaskListScreen.tsx         saved tasks, grouped by has-date / no-date
      EditTaskScreen.tsx         per-field edit + "Ask AI" NL edit + Leaving by
    components/
      TaskCard.tsx               structured result card, flags needs_clarification
    types/
      task.ts                    ParsedTask (LLM output) + TaskRow (DB row)
  supabase/
    migrations/
      ..._create_tasks_table.sql       tasks table + row-level security policies
      ..._add_departure_fields.sql     latitude/longitude/leaving_by/etc.
    functions/
      parse-task/index.ts        Deno Edge Function: calls Claude, validates w/ Zod
      edit-task/index.ts         NL task edits + title-sync
      geocode/index.ts           Google Places (New) + Geocoding API proxy
      travel-time/index.ts       Google Directions API proxy
      _shared/cors.ts
```

## One-time setup

### 1. Create a Supabase project

1. Go to https://supabase.com/dashboard and create a new project (free tier is fine).
2. In **Project Settings -> API**, copy the **Project URL** and the **anon public** key.
3. In **Project Settings -> General**, copy the **Reference ID** (looks like `abcdefghijklmnop`).

### 2. Configure the app's env vars

```bash
cp .env.example .env
```

Fill in `.env`:

```
EXPO_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

These are safe to expose to the client — the anon key only grants what your Row
Level Security policies allow (in this case, each user can only read/write their
own rows).

### 3. Get an Anthropic API key

Create a key at https://console.anthropic.com/settings/keys. **Do not** put this
in `.env` or anywhere client-side — it's used only by the Edge Function, server-side.

### 4. Link the CLI and push the database migration

The Supabase CLI is available via `npx`, no global install needed.

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

This creates the `tasks` table and its RLS policies (see
`supabase/migrations/`).

### 5. Set the Edge Function's secret and deploy it

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase functions deploy parse-task
```

`ANTHROPIC_API_KEY` lives only in Supabase's function secrets — it is never sent
to or bundled into the app.

### 6. Enable email/password auth

Email/password sign-up is on by default for new Supabase projects. If you don't
want email confirmation required (fine for solo/personal use), go to
**Authentication -> Providers -> Email** in the dashboard and turn off "Confirm email".

### 7. Set up "leaving by" departure reminders (optional)

This needs a Google Maps Platform API key with the **Geocoding API**,
**Places API (New)**, and **Directions API** all enabled (billing must be on
for the project, though usage at personal scale stays within the free tier).
Places API (New) is what resolves a bare business/chain name like "Barry's"
or "Equinox" to the nearest branch - without it, lookups fall back to the
plain Geocoding API, which can only resolve actual addresses and will fail
to find anything for a business name with no address in it. Create a key at
https://console.cloud.google.com/google/maps-apis, then:

```bash
npx supabase secrets set GOOGLE_MAPS_API_KEY=AIza...
npx supabase functions deploy geocode
npx supabase functions deploy travel-time
```

`GOOGLE_MAPS_API_KEY` lives only in Supabase's function secrets, same as
`ANTHROPIC_API_KEY` — it's never sent to or bundled into the app. Without this
key set, tasks still save normally; the "Leaving by" row just never appears
(the geocode/travel-time functions return a clear "server misconfigured" error
that the client treats the same as "couldn't compute this").

This feature also needs `expo-location` and `expo-notifications`, which are
native modules — they don't work in Expo Go or the web preview. Run
`npx expo run:ios` (or `run:android`) to build a dev client, or `eas build
--profile development` if you'd rather build in the cloud. Building locally on
iOS needs Xcode ≥16.1.

## Running the app locally

```bash
npm install
npm start
```

Then press `i` (iOS simulator), `a` (Android emulator), or scan the QR code with
Expo Go. On first launch you'll be asked to sign up — create your own
email/password account (this app has no shared/multi-tenant concept, it's for
your own use).

## Local Edge Function development (optional)

If you want to iterate on `parse-task` without deploying each time, you need
Docker running plus the Supabase CLI's local stack:

```bash
npx supabase start
npx supabase functions serve parse-task --env-file supabase/functions/.env.local
```

Create `supabase/functions/.env.local` (gitignored) with:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Then point the app at your local Supabase instance by temporarily setting
`EXPO_PUBLIC_SUPABASE_URL` to the local API URL printed by `supabase start`
(typically `http://127.0.0.1:54321`).

## Data model

See `supabase/migrations/20260728214206_create_tasks_table.sql` for the full
`tasks` table definition, and `src/types/task.ts` for the matching TypeScript
types (`ParsedTask` = what the LLM returns, `TaskRow` = what's stored in Postgres).

Fields left in place for future work (not used by this build): the schema and
types are structured so a location's `raw_text` can later be geocoded (Maps
Geocoding API) and turned into a "leave by" alarm (Maps Routes API), and so
`recurring_frequency` / `recurring_detail` can drive a scheduling engine.
