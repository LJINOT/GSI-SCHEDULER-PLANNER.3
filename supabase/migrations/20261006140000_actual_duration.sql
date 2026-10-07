-- Add actual_duration to tasks for Focus Mode measured time.
-- estimated_duration remains the user-provided estimate.
-- actual_duration is aggregated from time_entries and must never overwrite the estimate.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS actual_duration INTEGER;

COMMENT ON COLUMN public.tasks.estimated_duration IS
  'User-provided estimated duration in minutes. Source of truth for AHP/scheduling until actual data is available.';

COMMENT ON COLUMN public.tasks.actual_duration IS
  'Measured working duration in minutes from Focus Mode / time_entries. Does not overwrite estimated_duration.';
