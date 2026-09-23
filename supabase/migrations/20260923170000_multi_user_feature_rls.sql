-- Multi-user feature isolation and consistency
-- Apply after all existing migrations. Keeps every scheduler-related table
-- scoped to the authenticated Supabase user.

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.behavior_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_history ENABLE ROW LEVEL SECURITY;

-- Tasks
DROP POLICY IF EXISTS "Users can view own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can insert own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can update own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can delete own tasks" ON public.tasks;

CREATE POLICY "Users can view own tasks"
ON public.tasks FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tasks"
ON public.tasks FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tasks"
ON public.tasks FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tasks"
ON public.tasks FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- Projects
DROP POLICY IF EXISTS "Users manage their own projects" ON public.projects;

CREATE POLICY "Users manage their own projects"
ON public.projects FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Schedules
DROP POLICY IF EXISTS "Users can view own schedules" ON public.schedules;
DROP POLICY IF EXISTS "Users can insert own schedules" ON public.schedules;
DROP POLICY IF EXISTS "Users can update own schedules" ON public.schedules;
DROP POLICY IF EXISTS "Users can delete own schedules" ON public.schedules;

CREATE POLICY "Users can view own schedules"
ON public.schedules FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own schedules"
ON public.schedules FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own schedules"
ON public.schedules FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own schedules"
ON public.schedules FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- Time entries
DROP POLICY IF EXISTS "Users can view own entries" ON public.time_entries;
DROP POLICY IF EXISTS "Users can insert own entries" ON public.time_entries;
DROP POLICY IF EXISTS "Users can update own entries" ON public.time_entries;
DROP POLICY IF EXISTS "Users can delete own entries" ON public.time_entries;

CREATE POLICY "Users can view own entries"
ON public.time_entries FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own entries"
ON public.time_entries FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own entries"
ON public.time_entries FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own entries"
ON public.time_entries FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- Behavior logs
DROP POLICY IF EXISTS "Users can view own logs" ON public.behavior_logs;
DROP POLICY IF EXISTS "Users can insert own logs" ON public.behavior_logs;

CREATE POLICY "Users can view own logs"
ON public.behavior_logs FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own logs"
ON public.behavior_logs FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Recommendation history
DROP POLICY IF EXISTS "Users manage own recommendation history" ON public.recommendation_history;

CREATE POLICY "Users manage own recommendation history"
ON public.recommendation_history FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Task history
DROP POLICY IF EXISTS "Users manage their own task history" ON public.task_history;

CREATE POLICY "Users manage their own task history"
ON public.task_history FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO authenticated;
GRANT SELECT, INSERT ON public.behavior_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recommendation_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_history TO authenticated;
