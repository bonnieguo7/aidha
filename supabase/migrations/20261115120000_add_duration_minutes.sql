-- How long an event lasts, in minutes. Null means "no duration set" (every
-- existing row), which the app treats as it always has: the event ends when it
-- starts. Bounds match the app's own: 5 minutes to 24 hours.
alter table tasks
  add column duration_minutes integer
  check (duration_minutes is null or duration_minutes between 5 and 1440);
