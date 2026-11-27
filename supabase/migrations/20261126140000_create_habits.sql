-- Habits: things the user wants to do at some cadence ("clean my room every
-- day", "gym 3x a week"), on any day within the period. Each time the user does
-- one, a row goes into habit_checkins; progress and streaks are computed from
-- those on the device.

create table habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  title text not null check (length(btrim(title)) > 0),
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),
  target_count integer not null default 1 check (target_count between 1 and 31),
  -- Local wall-clock "HH:MM"; null = no reminder.
  reminder_time text check (reminder_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  notes text,
  -- Set instead of deleting, so past check-ins keep counting on the Profile.
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index habits_user_id_idx on habits (user_id);

alter table habits enable row level security;

create policy "Users can view their own habits"
  on habits for select
  using (auth.uid() = user_id);

create policy "Users can insert their own habits"
  on habits for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own habits"
  on habits for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own habits"
  on habits for delete
  using (auth.uid() = user_id);

create table habit_checkins (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references habits (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users,
  completed_at timestamptz not null default now()
);

create index habit_checkins_user_id_completed_at_idx on habit_checkins (user_id, completed_at);
create index habit_checkins_habit_id_completed_at_idx on habit_checkins (habit_id, completed_at);

alter table habit_checkins enable row level security;

create policy "Users can view their own habit check-ins"
  on habit_checkins for select
  using (auth.uid() = user_id);

-- Only onto one of the user's own habits.
create policy "Users can insert their own habit check-ins"
  on habit_checkins for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from habits h where h.id = habit_id and h.user_id = auth.uid())
  );

create policy "Users can delete their own habit check-ins"
  on habit_checkins for delete
  using (auth.uid() = user_id);
