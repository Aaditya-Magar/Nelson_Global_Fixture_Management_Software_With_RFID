import { createClient } from "@supabase/supabase-js";

// External Supabase project (publishable values — safe in browser)
const SUPABASE_URL = "https://humzkucjcxolhxusmmfv.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1bXprdWNqY3hvbGh4dXNtbWZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMjEyODAsImV4cCI6MjA5NTg5NzI4MH0.7wx-aMFmgzWsshD2IHIf-hyv3mG37Nqr6OQ0hFTf4Eg";

// Per-tab session storage + per-tab auth key keeps admin / gatekeeper / worker
// logins independent even when Supabase broadcasts auth changes across tabs.
const tabStorage = typeof window === "undefined" ? undefined : window.sessionStorage;

const tabStorageKey = (() => {
  if (typeof window === "undefined") return "nelson-fms-auth";
  const key = "nelson-fms-tab-id";
  let id = window.sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    window.sessionStorage.setItem(key, id);
  }
  return `nelson-fms-auth-${id}`;
})();

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: tabStorage,
    storageKey: tabStorageKey,
  },
});

export type Role = "admin" | "gatekeeper" | "worker";
