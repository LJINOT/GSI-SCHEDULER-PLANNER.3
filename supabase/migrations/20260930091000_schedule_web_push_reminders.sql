-- Run this only after deploying send-task-reminders and storing the required secrets.
-- This uses Supabase pg_cron + pg_net to invoke the reminder Edge Function every minute.
-- If pg_cron/pg_net are not enabled in your project, enable them from the Supabase Dashboard first.

-- Required secrets in Supabase Vault:
--   project_url       = https://YOUR_PROJECT_REF.supabase.co
--   service_role_key  = YOUR_SUPABASE_SERVICE_ROLE_KEY
--   reminder_cron_secret = the same value configured as REMINDER_CRON_SECRET
--
-- Then uncomment and run the block below in the Supabase SQL Editor.

/*
select cron.unschedule(jobid)
from cron.job
where jobname = 'gsi-send-task-reminders-every-minute';

select cron.schedule(
  'gsi-send-task-reminders-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/send-task-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
*/
