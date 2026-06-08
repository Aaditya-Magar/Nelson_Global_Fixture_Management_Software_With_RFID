import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import type { Role } from "@/lib/supabase";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";

const LOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function attemptKey(scope: string) {
  return `nelson-fms-login:${scope}`;
}

function checkLocked(scope: string): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(attemptKey(scope));
  if (!raw) return 0;
  try {
    const { until } = JSON.parse(raw) as { until: number };
    if (until > Date.now()) return until;
    window.localStorage.removeItem(attemptKey(scope));
  } catch {}
  return 0;
}

function recordFail(scope: string): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(attemptKey(scope));
  let count = 0;
  try {
    if (raw) count = (JSON.parse(raw).count as number) ?? 0;
  } catch {}
  count += 1;
  if (count >= MAX_ATTEMPTS) {
    const until = Date.now() + LOCK_MS;
    window.localStorage.setItem(attemptKey(scope), JSON.stringify({ count, until }));
    return until;
  }
  window.localStorage.setItem(attemptKey(scope), JSON.stringify({ count, until: 0 }));
  return 0;
}

function clearAttempts(scope: string) {
  if (typeof window !== "undefined") window.localStorage.removeItem(attemptKey(scope));
}

type Props = {
  scope: string;
  expectedRole: Role;
  successPath: string;
  title: string;
  subtitle?: string;
  theme: "light" | "navy" | "dark";
  children?: ReactNode;
};

export function LoginShell({ scope, expectedRole, successPath, title, subtitle, theme, children }: Props) {
  const { signIn } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const themeCls =
    theme === "navy"
      ? "bg-[#0a1628] text-white"
      : theme === "dark"
        ? "bg-[#0a0a0a] text-white"
        : "bg-background text-foreground";

  const cardCls =
    theme === "light"
      ? "bg-card text-card-foreground border border-border shadow-xl"
      : "bg-white/5 backdrop-blur border border-white/10";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const lockedUntil = checkLocked(scope);
    if (lockedUntil) {
      setErr("Too many attempts, please try again later.");
      return;
    }
    setBusy(true);
    const res = await signIn(email.trim().toLowerCase(), password);
    if (res.error || !res.profile || res.profile.role !== expectedRole) {
      // sign out if wrong role
      if (res.profile && res.profile.role !== expectedRole) {
        await (await import("@/lib/supabase")).supabase.auth.signOut({ scope: "local" });
      }
      const until = recordFail(scope);
      setErr(until ? "Too many attempts, please try again later." : "Invalid credentials");
      setBusy(false);
      return;
    }
    clearAttempts(scope);
    navigate({ to: successPath });
  };

  return (
    <div className={`min-h-screen flex items-center justify-center px-4 ${themeCls}`}>
      <div className={`w-full max-w-md rounded-2xl p-8 ${cardCls}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 text-sm opacity-70">{subtitle}</p>}
          </div>
          <LanguageSwitcher />
        </div>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider opacity-70">{t("auth.email")}</label>
            <input
              type="email"
              required
              autoComplete="username"
              maxLength={255}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-border/40 bg-transparent px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider opacity-70">{t("auth.password")}</label>
            <div className="relative mt-1">
              <input
                type={showPwd ? "text" : "password"}
                required
                autoComplete="current-password"
                maxLength={100}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-border/40 bg-transparent px-3 py-2.5 pr-10 text-sm outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                aria-label={showPwd ? t("auth.hide_password") : t("auth.show_password")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded opacity-70 hover:opacity-100"
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {err && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition disabled:opacity-60 hover:bg-primary/90"
          >
            {busy ? t("auth.signing_in") : t("auth.signin")}
          </button>
        </form>
        {children}
      </div>
    </div>
  );
}
