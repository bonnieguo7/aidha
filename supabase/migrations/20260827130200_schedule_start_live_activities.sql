create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- The service-role key used to authorize this cron job's call into the
-- start-live-activities edge function is stored via Supabase Vault, not
-- inlined here - migration files are plaintext and get committed to git, so
-- the literal key must never live in one. Before this migration is applied,
-- run once, manually, in the Supabase SQL editor (NOT as a migration):
--   select vault.create_secret('<service-role-key>', 'start_live_activities_service_key');
select cron.schedule(
  'start-live-activities',
  '* * * * *', -- every minute
  $$
  select net.http_post(
    url := 'https://ckcpppbkfyrbwabkkpli.functions.supabase.co/start-live-activities',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'start_live_activities_service_key'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
