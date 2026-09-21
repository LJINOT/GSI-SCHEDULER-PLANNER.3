ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS peak_start text DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS peak_end text DEFAULT '12:00',
  ADD COLUMN IF NOT EXISTS break_style text DEFAULT 'pomodoro',
  ADD COLUMN IF NOT EXISTS occupation text,
  ADD COLUMN IF NOT EXISTS organization text,
  ADD COLUMN IF NOT EXISTS profile_kind text DEFAULT 'general';