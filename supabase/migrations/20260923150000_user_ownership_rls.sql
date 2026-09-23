-- Ensure tasks/projects RLS is correct for multi-user isolation
-- Do NOT disable RLS. Re-apply ownership policies safely.

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

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

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
