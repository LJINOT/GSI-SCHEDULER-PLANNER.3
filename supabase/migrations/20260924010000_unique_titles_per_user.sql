-- Per-user unique task titles and project names (case-insensitive, trimmed)
-- Does not delete data. Skips index creation if duplicates still exist.

-- Optional: report duplicates (no delete)
-- SELECT user_id, lower(trim(title)), count(*) FROM tasks WHERE coalesce(archived,false)=false GROUP BY 1,2 HAVING count(*)>1;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_user_id_lower_title_uidx
  ON public.tasks (user_id, lower(trim(title)))
  WHERE coalesce(archived, false) = false
    AND title IS NOT NULL
    AND length(trim(title)) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS projects_user_id_lower_name_uidx
  ON public.projects (user_id, lower(trim(name)))
  WHERE coalesce(archived, false) = false
    AND name IS NOT NULL
    AND length(trim(name)) > 0;
