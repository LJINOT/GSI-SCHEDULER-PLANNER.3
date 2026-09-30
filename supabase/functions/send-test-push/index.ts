import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

const admin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
);

webpush.setVapidDetails(
  "mailto:gsi-schedule-planner@example.com",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type PushSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

Deno.serve(async (req) => {
  // Handle browser CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "Method not allowed",
      }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  try {
    // ---------------------------------------------------------
    // 1. Get the logged-in user's JWT
    // ---------------------------------------------------------

    const authorization = req.headers.get("Authorization");

    if (!authorization) {
      return new Response(
        JSON.stringify({
          error: "Missing Authorization header.",
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const userClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: {
            Authorization: authorization,
          },
        },
      },
    );

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({
          error: "You must be signed in to send a test notification.",
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // ---------------------------------------------------------
    // 2. Get this user's saved browser subscriptions
    // ---------------------------------------------------------

    const { data: subscriptions, error: subscriptionError } =
      await admin
        .from("push_subscriptions")
        .select(
          "id,user_id,endpoint,p256dh,auth",
        )
        .eq("user_id", user.id);

    if (subscriptionError) {
      throw subscriptionError;
    }

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            "No push subscription was found for this account. Enable Desktop Notifications first.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // ---------------------------------------------------------
    // 3. Create the test notification payload
    // ---------------------------------------------------------

    const payload = JSON.stringify({
      title: "GSI Schedule Planner",
      body:
        "Test notification successful. You can now switch to another app or website and still receive GSI reminders.",
      url: "/settings/general",
      tag: "gsi-test-push",
      requireInteraction: false,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      timestamp: Date.now(),
    });

    let sent = 0;
    let removed = 0;
    const errors: string[] = [];

    // ---------------------------------------------------------
    // 4. Send real Web Push notification
    // ---------------------------------------------------------

    for (const subscription of subscriptions as PushSubscription[]) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          payload,
        );

        sent++;
      } catch (error: any) {
        const statusCode = error?.statusCode;

        console.error(
          "Web Push error:",
          statusCode,
          error?.message || error,
        );

        // Browser subscription no longer exists
        if (statusCode === 404 || statusCode === 410) {
          await admin
            .from("push_subscriptions")
            .delete()
            .eq("id", subscription.id);

          removed++;
        } else {
          errors.push(
            `Subscription ${subscription.id}: ${
              error?.message || "Unknown push error"
            }`,
          );
        }
      }
    }

    // ---------------------------------------------------------
    // 5. Return result to frontend
    // ---------------------------------------------------------

    if (sent === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          sent: 0,
          removed,
          errors,
          error:
            "The push server could not deliver the notification to your browser.",
        }),
        {
          status: 502,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sent,
        removed,
        errors,
        message: "Real Web Push notification sent successfully.",
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error: any) {
    console.error(
      "send-test-push error:",
      error,
    );

    return new Response(
      JSON.stringify({
        ok: false,
        error:
          error?.message ||
          "Failed to send test push notification.",
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