import { supabase } from "@/integrations/supabase/client";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
const SW_PATH = "/sw.js";

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function pushSupported() {
  return typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
}

export async function getPushPermission() {
  if (!pushSupported()) return "unsupported" as const;
  return Notification.permission;
}

export async function enablePushNotifications() {
  if (!pushSupported()) {
    throw new Error("This browser does not support desktop push notifications.");
  }
  if (!VAPID_PUBLIC_KEY) {
    throw new Error("VITE_VAPID_PUBLIC_KEY is missing from the frontend environment.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const registration = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();

  // VAPID keys are tied to a push subscription. If the project rotates its
  // VAPID key pair, an existing browser subscription may still be bound to
  // the previous public key and push services can reject sends with HTTP 401/403.
  // Remember which public key this browser used and recreate the subscription
  // when the configured key changes.
  const vapidKeyStorage = "gsi-vapid-public-key";
  const previousVapidKey = localStorage.getItem(vapidKeyStorage);
  if (subscription && previousVapidKey && previousVapidKey !== VAPID_PUBLIC_KEY) {
    try {
      await subscription.unsubscribe();
    } finally {
      subscription = null;
    }
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  localStorage.setItem(vapidKeyStorage, VAPID_PUBLIC_KEY);

  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    throw new Error("The browser returned an incomplete push subscription.");
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in to enable notifications.");

  const db = supabase as any;
  const { error } = await db.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (error) throw error;
  localStorage.setItem("gsi-push-enabled", "true");
  return subscription;
}

export async function disablePushNotifications() {
  if (!pushSupported()) return;

  const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
  const subscription = await registration?.pushManager.getSubscription();
  const endpoint = subscription?.endpoint;

  if (endpoint) {
    const db = supabase as any;
    await db.from("push_subscriptions").delete().eq("endpoint", endpoint);
    await subscription?.unsubscribe();
  }

  localStorage.removeItem("gsi-push-enabled");
}

export async function isPushEnabled() {
  if (!pushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
  const subscription = await registration?.pushManager.getSubscription();
  return Boolean(subscription) && Notification.permission === "granted";
}

export async function getSavedPushSubscriptions(): Promise<PushSubscriptionRow[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const db = supabase as any;
  const { data } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", user.id);
  return data || [];
}
