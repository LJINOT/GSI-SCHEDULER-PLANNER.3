-- Backend bugfixes: completed_at, recommendation history, duration trigger, auto status transition

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL;

UPDATE public.tasks
SET completed_at = COALESCE(completed_at, updated_at)
WHERE status = 'done' AND completed_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_task_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  ELSIF NEW.status IS DISTINCT FROM 'done' AND OLD.status = 'done' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_completed_at ON public.tasks;
CREATE TRIGGER trg_tasks_completed_at
  BEFORE UPDATE OF status ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_task_completed_at();

CREATE OR REPLACE FUNCTION public.set_time_entry_duration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.end_time IS NOT NULL AND NEW.start_time IS NOT NULL THEN
    NEW.duration := GREATEST(1, ROUND(EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 60.0)::int);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_time_entry_duration ON public.time_entries;
CREATE TRIGGER trg_time_entry_duration
  BEFORE INSERT OR UPDATE OF start_time, end_time ON public.time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_time_entry_duration();

CREATE TABLE IF NOT EXISTS public.recommendation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'smart-picks',
  picks jsonb NOT NULL DEFAULT '[]'::jsonb,
  factors jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_history_user_created
  ON public.recommendation_history (user_id, created_at DESC);

ALTER TABLE public.recommendation_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own recommendation history" ON public.recommendation_history;
CREATE POLICY "Users manage own recommendation history"
  ON public.recommendation_history
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.transition_due_task_statuses(p_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE public.tasks
  SET status = 'in_progress', updated_at = now()
  WHERE status = 'todo'
    AND archived = false
    AND start_time IS NOT NULL
    AND start_time <= now()
    AND (p_user_id IS NULL OR user_id = p_user_id);

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transition_due_task_statuses(uuid) TO authenticated;
