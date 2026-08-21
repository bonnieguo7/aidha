create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  raw_input text not null,
  type text not null check (type in ('event', 'task')),
  title text not null,
  datetime timestamptz,
  date_certainty text not null check (date_certainty in ('exact', 'approximate', 'none')),
  location_raw_text text,
  location_place_type text check (location_place_type in ('specific_address', 'known_place', 'category', 'none')),
  recurring_frequency text check (recurring_frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  recurring_detail text,
  priority text check (priority in ('high', 'normal', 'low')),
  requires_downtime boolean not null default false,
  created_at timestamptz not null default now()
);

create index tasks_user_id_idx on tasks (user_id);
create index tasks_user_id_datetime_idx on tasks (user_id, datetime);

alter table tasks enable row level security;

create policy "Users can view their own tasks"
  on tasks for select
  using (auth.uid() = user_id);

create policy "Users can insert their own tasks"
  on tasks for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own tasks"
  on tasks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own tasks"
  on tasks for delete
  using (auth.uid() = user_id);
