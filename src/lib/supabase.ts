import { createClient } from "@supabase/supabase-js";

class ServerOnlyWebSocket {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readonly readyState = 3;
  readonly url: string;
  readonly protocol = "";
  onopen: ((this: unknown, ev: Event) => unknown) | null = null;
  onmessage: ((this: unknown, ev: MessageEvent) => unknown) | null = null;
  onclose: ((this: unknown, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: unknown, ev: Event) => unknown) | null = null;

  constructor(address: string | URL) {
    this.url = address.toString();
  }

  close() {}
  send() {}
  addEventListener() {}
  removeEventListener() {}
}

// External Supabase project (publishable values — safe in browser)
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? "https://humzkucjcxolhxusmmfv.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1bXprdWNqY3hvbGh4dXNtbWZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMjEyODAsImV4cCI6MjA5NTg5NzI4MH0.7wx-aMFmgzWsshD2IHIf-hyv3mG37Nqr6OQ0hFTf4Eg";

// Per-tab session storage + per-tab auth key keeps admin / gatekeeper / worker
// logins independent even when Supabase broadcasts auth changes across tabs.
const tabStorage = typeof window === "undefined" ? undefined : window.sessionStorage;
const realtime =
  typeof window === "undefined"
    ? { transport: ServerOnlyWebSocket }
    : undefined;

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
  realtime,
});

export type Role = "admin" | "gatekeeper" | "worker";
