-- One push-to-start token per installed app, instead of one per user. The dev
-- build and the TestFlight build are separate apps to iOS (different bundle
-- ids and APNs environments), each with its own token; with a single row per
-- user, opening one replaced the other's token and Live Activities were pushed
-- to the wrong app (APNs: DeviceTokenNotForTopic). device_push_tokens is left
-- in place for app versions that still write to it.

create table live_activity_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  bundle_id text not null,
  apns_environment text not null check (apns_environment in ('sandbox', 'production')),
  push_to_start_token text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, bundle_id)
);

alter table live_activity_tokens enable row level security;

create policy "Users can view their own Live Activity tokens"
  on live_activity_tokens for select
  using (auth.uid() = user_id);

create policy "Users can insert their own Live Activity tokens"
  on live_activity_tokens for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own Live Activity tokens"
  on live_activity_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
