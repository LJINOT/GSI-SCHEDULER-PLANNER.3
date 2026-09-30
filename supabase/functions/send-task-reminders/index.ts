import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "https://xwlmucvdwwwimdfnatfc.supabase.co";
const REMINDER_CRON_SECRET = Deno.env.get("REMINDER_CRON_SECRET") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type Task = {
  id: string;
  user_id: string;
  title: string;
  status: string;
  due_date: string | null;
  start_time: string | null;
  archived: boolean;
};

type Subscription = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type Reminder = {
  type: "task_starting" | "deadline_24h" | "deadline_1h" | "overdue";
  task: Task;
  title: string;
  body: string;
  url: string;
  dedupeKey: string;
  requireInteraction?: boolean;
};

function minuteKey(date: Date) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d.toISOString();
}

function sameMinute(a: Date, b: Date) {
  return minuteKey(a) === minuteKey(b);
}

function buildReminders(tasks: Task[], now: Date): Reminder[] {
  const reminders: Reminder[] = [];

  for (const task of tasks) {
    if (task.status === "done" || task.archived) continue;

    const baseUrl = `/tasks?task=${task.id}`;

    if (task.start_time) {
      const start = new Date(task.start_time);
      const reminderAt = new Date(start.getTime() - 15 * 60 * 1000);
      if (sameMinute(reminderAt, now) && start.getTime() > now.getTime()) {
        reminders.push({
          type: "task_starting",
          task,
          title: "Task Starting Soon",
          body: `${task.title} starts in 15 minutes.`,
          url: baseUrl,
          dedupeKey: `${task.id}:task_starting:${minuteKey(reminderAt)}`,
        });
      }
    }

    if (task.due_date) {
      const due = new Date(task.due_date);
      const twentyFourHours = new Date(due.getTime() - 24 * 60 * 60 * 1000);
      const oneHour = new Date(due.getTime() - 60 * 60 * 1000);

      if (sameMinute(twentyFourHours, now) && due.getTime() > now.getTime()) {
        reminders.push({
          type: "deadline_24h",
          task,
          title: "Deadline in 24 Hours",
          body: `${task.title} is due in about 24 hours.`,
          url: baseUrl,
          dedupeKey: `${task.id}:deadline_24h:${due.toISOString()}`,
        });
      }

      if (sameMinute(oneHour, now) && due.getTime() > now.getTime()) {
        reminders.push({
          type: "deadline_1h",
          task,
          title: "Deadline in 1 Hour",
          body: `${task.title} is due in about 1 hour.`,
          url: baseUrl,
          dedupeKey: `${task.id}:deadline_1h:${due.toISOString()}`,
          requireInteraction: true,
        });
      }

      // Fire once during the first minute after the deadline.
      const overdueAt = new Date(due.getTime() + 60 * 1000);
      if (sameMinute(overdueAt, now) && due.getTime() <= now.getTime()) {
        reminders.push({
          type: "overdue",
          task,
          title: "Task Overdue",
          body: `${task.title} has passed its deadline and is still incomplete.`,
          url: baseUrl,
          dedupeKey: `${task.id}:overdue:${due.toISOString()}`,
          requireInteraction: true,
        });
      }
    }
  }

  return reminders;
}

async function getSubscriptions(userIds: string[]) {
  if (!userIds.length) return [] as Subscription[];
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", userIds);
  if (error) throw error;
  return (data || []) as Subscription[];
}

async function sendReminder(reminder: Reminder, subscriptions: Subscription[]) {
  const payload = JSON.stringify({
    title: reminder.title,
    body: reminder.body,
    url: reminder.url,
    taskId: reminder.task.id,
    tag: reminder.dedupeKey,
    requireInteraction: reminder.requireInteraction ?? false,
    icon: "/favicon.ico",
    badge: "/favicon.ico",
  });

  for (const subscription of subscriptions.filter((s) => s.user_id === reminder.task.user_id)) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
      );
    } catch (error: any) {
      const status = error?.statusCode;
      if (status === 404 || status === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", subscription.id);
      } else {
        console.error("Push delivery failed", reminder.task.id, status, error?.message || error);
      }
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // This endpoint is intended for a server-side scheduler, not direct browser calls.
  if (REMINDER_CRON_SECRET) {
    const supplied = req.headers.get("x-cron-secret");
    if (supplied !== REMINDER_CRON_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error("Supabase service environment variables are incomplete.");
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error("VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY is missing. Add both as Supabase Edge Function secrets.");
    }
    webpush.setVapidDetails(
      VAPID_SUBJECT,
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY,
    );

    const now = new Date();
    const { data: tasks, error: taskError } = await supabase
      .from("tasks")
      .select("id,user_id,title,status,due_date,start_time,archived")
      .eq("archived", false)
      .neq("status", "done")
      .or("start_time.not.is.null,due_date.not.is.null");

    if (taskError) throw taskError;

    // Re-filter in JavaScript so null values and both reminder windows are handled consistently.
    const candidates = (tasks || []) as Task[];
    const reminders = buildReminders(candidates, now);
    const userIds = [...new Set(reminders.map((r) => r.task.user_id))];
    const subscriptions = await getSubscriptions(userIds);

    let sent = 0;
    let skipped = 0;

    for (const reminder of reminders) {
      const { data: existing } = await supabase
        .from("notification_delivery_log")
        .select("id")
        .eq("dedupe_key", reminder.dedupeKey)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      await sendReminder(reminder, subscriptions);
      await supabase.from("notification_delivery_log").insert({
        user_id: reminder.task.user_id,
        task_id: reminder.task.id,
        notification_type: reminder.type,
        dedupe_key: reminder.dedupeKey,
        title: reminder.title,
        body: reminder.body,
      });
      sent++;
    }

    return new Response(JSON.stringify({ ok: true, now: now.toISOString(), reminders: reminders.length, sent, skipped }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error(error);
    return new Response(JSON.stringify({ error: error?.message || "Reminder job failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
