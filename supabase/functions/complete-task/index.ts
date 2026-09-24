import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") || "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    let body: { task_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const taskId = String(body.task_id || "").trim();

    if (!taskId) {
      return new Response(
        JSON.stringify({ error: "task_id is required." }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    /*
     * IMPORTANT:
     * Every task lookup is explicitly scoped to the authenticated user.
     * This keeps completion and adaptive scheduling isolated for new users.
     */
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select(
        "id, title, status, archived, start_time, estimated_duration",
      )
      .eq("id", taskId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (taskError) throw taskError;

    if (!task) {
      return new Response(
        JSON.stringify({
          error: "Task not found for the current user.",
        }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    if (task.archived) {
      return new Response(
        JSON.stringify({
          error: "Archived tasks cannot be completed from the scheduler.",
        }),
        {
          status: 409,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    /*
     * Close an accidentally open focus/time entry first.
     * The database trigger calculates its duration automatically.
     */
    const nowIso = new Date().toISOString();

    const { data: openEntries, error: openEntriesError } =
      await supabase
        .from("time_entries")
        .select("id, start_time")
        .eq("user_id", user.id)
        .eq("task_id", task.id)
        .is("end_time", null);

    if (openEntriesError) throw openEntriesError;

    for (const entry of openEntries || []) {
      const { error } = await supabase
        .from("time_entries")
        .update({ end_time: nowIso })
        .eq("id", entry.id)
        .eq("user_id", user.id);

      if (error) throw error;
    }

    /*
     * Mark completion and remove the old scheduled start.
     * completed_at is also protected by the database trigger.
     */
    const { data: completedTask, error: completeError } =
      await supabase
        .from("tasks")
        .update({
          status: "done",
          completed_at: nowIso,
          start_time: null,
        })
        .eq("id", task.id)
        .eq("user_id", user.id)
        .select("id, title, status, completed_at")
        .single();

    if (completeError) throw completeError;

    /*
     * Re-run the adaptive layer using the SAME authenticated user.
     *
     * The adaptive scheduler:
     * - loads all active tasks for this user
     * - keeps valid future tasks in place
     * - finds unfinished/overdue scheduled tasks
     * - uses actual recorded work to calculate remaining duration
     * - searches today first
     * - then searches later working days before each deadline
     * - respects work hours, breaks, deadlines and no-overlap constraints
     * - records adaptive changes in task_history
     */
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let adaptive: any = null;
    let adaptiveWarning: string | null = null;

    try {
      const response = await fetch(
        `${supabaseUrl}/functions/v1/generate-schedule`,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            apikey: anonKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            adaptive: true,
          }),
        },
      );

      const text = await response.text();

      let parsed: any = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = {};
      }

      if (!response.ok || parsed?.error) {
        adaptiveWarning =
          parsed?.error ||
          `Adaptive scheduling returned HTTP ${response.status}.`;
      } else {
        adaptive = parsed;
      }
    } catch (error) {
      adaptiveWarning =
        error instanceof Error
          ? error.message
          : String(error);
    }

    /*
     * Always remove the completed task from saved schedule timelines.
     * This is a final consistency repair in case there were no other
     * unfinished tasks to trigger a schedule-date rebuild.
     */
    try {
      const { data: savedSchedules } = await supabase
        .from("schedules")
        .select("id, timeline")
        .eq("user_id", user.id);

      for (const schedule of savedSchedules || []) {
        const timeline = Array.isArray(schedule.timeline)
          ? schedule.timeline
          : [];

        const cleaned = timeline.filter(
          (block: any) => block?.task_id !== task.id,
        );

        if (cleaned.length !== timeline.length) {
          await supabase
            .from("schedules")
            .update({ timeline: cleaned })
            .eq("id", schedule.id)
            .eq("user_id", user.id);
        }
      }
    } catch (cleanupError) {
      /*
       * The task itself is already completed. Return a warning instead
       * of pretending that the schedule cleanup failed the completion.
       */
      const message =
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError);

      adaptiveWarning =
        adaptiveWarning
          ? `${adaptiveWarning} Schedule cleanup: ${message}`
          : `Schedule cleanup: ${message}`;
    }

    return new Response(
      JSON.stringify({
        success: true,
        task: completedTask,
        adaptive: adaptive?.adaptive === true,
        adaptive_moves: adaptive?.adaptive_moves || [],
        deferred: adaptive?.deferred || [],
        touched_dates: adaptive?.touched_dates || [],
        warning: adaptiveWarning,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error("complete-task error:", error);

    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : String(error),
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
