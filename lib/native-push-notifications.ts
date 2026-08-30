"use client";

import { Capacitor } from "@capacitor/core";
import { PushNotifications, type Token } from "@capacitor/push-notifications";
import { createClient } from "@/lib/supabase/client";

const TOKEN_KEY = "juntos-native-push-token";
let navigationListenerReady = false;

export const isNativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

export async function setupNativePushNavigation() {
  if (!isNativeAndroid() || navigationListenerReady) return;
  navigationListenerReady = true;
  await PushNotifications.addListener("pushNotificationActionPerformed", event => {
    const target = String(event.notification.data?.url || "/");
    window.location.assign(new URL(target, "https://juntos-finance.vercel.app").href);
  });
}

const saveToken = async (token: string, userId: string, workspaceId: string) => {
  const supabase = createClient();
  const { error } = await supabase.from("native_push_tokens").upsert({
    user_id: userId,
    workspace_id: workspaceId,
    token,
    platform: "android",
    device_label: navigator.userAgent.slice(0, 240),
    updated_at: new Date().toISOString(),
  }, { onConflict: "token" });
  if (error) throw error;
  localStorage.setItem(TOKEN_KEY, token);
};

export async function enableNativePush(userId: string, workspaceId: string) {
  if (!isNativeAndroid()) throw new Error("O push nativo está disponível somente no aplicativo Android.");
  let permission = await PushNotifications.checkPermissions();
  if (permission.receive === "prompt") permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") throw new Error("Permissão de notificações bloqueada no Android.");

  await PushNotifications.createChannel({
    id: "juntos_finance_alerts",
    name: "Alertas financeiros",
    description: "Contas, orçamentos, metas e avisos importantes.",
    importance: 5,
    visibility: 1,
    vibration: true,
  });
  await setupNativePushNavigation();

  const token = await new Promise<Token>(async (resolve, reject) => {
    const registered = await PushNotifications.addListener("registration", value => resolve(value));
    const failed = await PushNotifications.addListener("registrationError", error => reject(new Error(error.error || "Falha ao registrar o dispositivo.")));
    try { await PushNotifications.register(); }
    catch (error) { reject(error); }
    setTimeout(() => { void registered.remove(); void failed.remove(); reject(new Error("O Firebase não respondeu ao registro do dispositivo.")); }, 15000);
  });
  await saveToken(token.value, userId, workspaceId);
  return token.value;
}

export async function disableNativePush() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) await createClient().from("native_push_tokens").delete().eq("token", token);
  localStorage.removeItem(TOKEN_KEY);
  if (isNativeAndroid()) await PushNotifications.unregister();
}

export async function hasNativePushToken() {
  if (!isNativeAndroid()) return false;
  const permission = await PushNotifications.checkPermissions();
  return permission.receive === "granted" && Boolean(localStorage.getItem(TOKEN_KEY));
}