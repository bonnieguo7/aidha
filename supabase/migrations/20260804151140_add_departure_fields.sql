alter table tasks add column latitude double precision;
alter table tasks add column longitude double precision;
alter table tasks add column travel_duration_minutes integer;
alter table tasks add column leaving_by timestamptz;
alter table tasks add column leaving_notification_id text;
alter table tasks add column leaving_by_error boolean not null default false;
