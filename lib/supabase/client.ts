import { createBrowserClient } from "@supabase/ssr";

type SupabaseBrowserConfig = {
  url: string;
  anonKey: string;
};

let runtimeConfig: SupabaseBrowserConfig | null = null;

export function configureSupabaseClient(config: SupabaseBrowserConfig) {
  runtimeConfig = config;
}

export function createClient() {
  if (!runtimeConfig?.url || !runtimeConfig.anonKey) {
    throw new Error("Supabase não está configurado no navegador.");
  }

  return createBrowserClient(runtimeConfig.url, runtimeConfig.anonKey);
}
