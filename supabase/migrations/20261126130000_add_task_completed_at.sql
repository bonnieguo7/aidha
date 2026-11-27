-- When the user checked a task off, for "done today / this week" counts. Null
-- for anything not completed, completed before this column existed, or archived
-- automatically (past events) rather than ticked off by the user.
alter table tasks add column completed_at timestamptz;

create index tasks_user_id_completed_at_idx on tasks (user_id, completed_at);
