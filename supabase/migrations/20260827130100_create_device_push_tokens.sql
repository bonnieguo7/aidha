create table device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  push_to_start_token text not null,
  platform text not null default 'ios' check (platform in ('ios')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform)
);

create index device_push_tokens_user_id_idx on device_push_tokens (user_id);

alter table device_push_tokens enable row level security;

create policy "Users can view their own push tokens"
  on device_push_tokens for select
  using (auth.uid() = user_id);

create policy "Users can insert their own push tokens"
  on device_push_tokens for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own push tokens"
  on device_push_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
