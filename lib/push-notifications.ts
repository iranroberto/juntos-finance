"use client";

import { createClient } from "@/lib/supabase/client";

export type NotificationType =
  | "bill_due" | "bill_overdue" | "budget_warning" | "budget_exceeded"
  | "goal_progress" | "goal_completed" | "financial_alert";

export type NotificationPayload = {
  title: string;
  body: string;
  type: NotificationType;
  url: string;
  icon?: string;
  entityId?: string;
};

export type PushPreferences = {
  bills: boolean;
  budgets: boolean;
  goals: boolean;
  financialAlerts: boolean;
};

const decodeVapidKey = (value: string) => {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
};

const subscriptionKeys = (subscription: PushSubscription) => {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("Subscription inválida.");
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
};

export async function enableWebPush(userId: string, workspaceId: string) {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Este navegador não oferece suporte a notificações em segundo plano.");
  }
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) throw new Error("A chave pública de notificações ainda não foi configurada.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied"
    ? "A permissão foi bloqueada. Libere as notificações nas configurações do navegador."
    : "A permissão de notificações não foi concedida.");
  const registration = await navigator.serviceWorker.ready;
  const current = await registration.pushManager.getSubscription();
  const subscription = current || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidKey(publicKey),
  });
  const keys = subscriptionKeys(subscription);
  const supabase = createClient();
  const { error } = await supabase.from("push_subscriptions").upsert({
    user_id: userId,
    workspace_id: workspaceId,
    ...keys,
    user_agent: navigator.userAgent,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });
  if (error) {
    if (!current) await subscription.unsubscribe().catch(() => false);
    throw error;
  }
  return subscription;
}

export async function disableWebPush() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const supabase = createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  await subscription.unsubscribe();
}

export async function hasWebPushSubscription() {
  if (!("serviceWorker" in navigator) || Notification.permission !== "granted") return false;
  return Boolean(await (await navigator.serviceWorker.ready).pushManager.getSubscription());
}

export async function savePushPreferences(userId: string, workspaceId: string, preferences: PushPreferences) {
  const supabase = createClient();
  const { error } = await supabase.from("notification_preferences").upsert({
    user_id: userId,
    workspace_id: workspaceId,
    bills: preferences.bills,
    budgets: preferences.budgets,
    goals: preferences.goals,
    financial_alerts: preferences.financialAlerts,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,workspace_id" });
  if (error) throw error;
}