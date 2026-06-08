import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { Home, Search, ClipboardList, LogOut } from "lucide-react";
import { useEffect } from "react";
import { RequireRole } from "@/components/RequireRole";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "@tanstack/react-router";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";

export const Route = createFileRoute("/worker")({
  component: WorkerLayout,
});

function WorkerLayout() {
  return (
    <RequireRole role="worker" loginPath="/login">
      <Shell />
    </RequireRole>
  );
}

function Shell() {
  const { profile, signOut } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();

  // Realtime ready-notification banner
  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel(`worker-ready-${profile.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "requests", filter: `worker_id=eq.${profile.id}` },
        (payload) => {
          const row = payload.new as { status: string };
          if (row.status === "ready") {
            import("sonner").then(({ toast }) => toast.success("A fixture is ready for collection!"));
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile]);

  const tabs = [
    { to: "/worker", label: t("nav.home"), icon: Home, exact: true },
    { to: "/worker/search", label: t("nav.search"), icon: Search },
    { to: "/worker/requests", label: t("nav.requests"), icon: ClipboardList },
  ];

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-30 bg-primary text-primary-foreground px-4 py-3 shadow-sm flex items-center justify-between">
        <div>
          <div className="text-xs opacity-80">{t("worker.title")}</div>
          <div className="text-sm font-semibold">{profile?.full_name}</div>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <button
            onClick={async () => { await signOut(); nav({ to: "/login" }); }}
            className="p-2 rounded-md hover:bg-white/10"
            aria-label={t("nav.signout")}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>
      <main className="max-w-4xl mx-auto p-4 sm:p-6 w-full">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border">
        <div className="max-w-4xl mx-auto grid grid-cols-3">
          {tabs.map((tt) => {
            const active = tt.exact ? loc.pathname === tt.to : loc.pathname.startsWith(tt.to);
            const Icon = tt.icon;
            return (
              <Link
                key={tt.to}
                to={tt.to}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${active ? "text-primary" : "text-muted-foreground"}`}
              >
                <Icon className="h-5 w-5" />
                {tt.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
