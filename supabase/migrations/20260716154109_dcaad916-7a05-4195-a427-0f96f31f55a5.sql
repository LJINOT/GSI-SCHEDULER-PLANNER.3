
UPDATE public.tasks
SET start_time = due_date - (COALESCE(estimated_duration, 60) || ' minutes')::interval
WHERE user_id = '23cde60f-a414-4890-92aa-bbda105a5490'
  AND due_date IS NOT NULL
  AND start_time IS NOT NULL
  AND start_time = due_date;
