alter table tasks add column is_completed boolean not null default false;

create index tasks_user_id_is_completed_idx on tasks (user_id, is_completed);
