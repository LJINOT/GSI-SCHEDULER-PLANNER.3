-- Official schedule metadata (safe additive columns)
ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS version integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS fingerprint text,
  ADD COLUMN IF NOT EXISTS created_by text DEFAULT 'auto_schedule',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'current',
  ADD COLUMN IF NOT EXISTS work_start text,
  ADD COLUMN IF NOT EXISTS work_end text,
  ADD COLUMN IF NOT EXISTS algorithm text;

-- Index for current schedule lookups
CREATE INDEX IF NOT EXISTS schedules_user_date_status_idx
  ON public.schedules (user_id, schedule_date, status);
