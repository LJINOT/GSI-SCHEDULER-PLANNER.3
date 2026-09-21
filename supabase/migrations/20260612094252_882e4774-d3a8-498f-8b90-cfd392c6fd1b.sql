
-- 1. Realtime: enable RLS and scope subscriptions to user-owned topics
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can subscribe to own topics" ON realtime.messages;
CREATE POLICY "Users can subscribe to own topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (realtime.topic() LIKE 'user:' || auth.uid()::text || ':%')
  OR (realtime.topic() LIKE '%:' || auth.uid()::text)
  OR (realtime.topic() = auth.uid()::text)
);

-- 2. Schedules: allow users to delete their own schedules
DROP POLICY IF EXISTS "Users can delete own schedules" ON public.schedules;
CREATE POLICY "Users can delete own schedules"
ON public.schedules
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- 3. user_roles: explicit deny policies to prevent privilege escalation
DROP POLICY IF EXISTS "Deny user role inserts" ON public.user_roles;
CREATE POLICY "Deny user role inserts"
ON public.user_roles
AS RESTRICTIVE
FOR INSERT
TO authenticated, anon
WITH CHECK (false);

DROP POLICY IF EXISTS "Deny user role updates" ON public.user_roles;
CREATE POLICY "Deny user role updates"
ON public.user_roles
AS RESTRICTIVE
FOR UPDATE
TO authenticated, anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "Deny user role deletes" ON public.user_roles;
CREATE POLICY "Deny user role deletes"
ON public.user_roles
AS RESTRICTIVE
FOR DELETE
TO authenticated, anon
USING (false);

-- 4. Revoke EXECUTE on internal trigger functions from API roles
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
