import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { LogOut, ListChecks, RotateCcw } from "lucide-react";
import { RequireRole } from "@/components/RequireRole";
import { useAuth } from "@/lib/auth-context";
import { useNavigate } from "@tanstack/react-router";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";
import { GateStatusIndicator } from "@/components/GateStatusIndicator";

export const Route = createFileRoute("/gatekeeper")({
  component: () => (
    <RequireRole role="gatekeeper" loginPath="/secure/gate-access">
      <Layout />
    </RequireRole>
  ),
});

function Layout() {
  const { profile, signOut } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();
  const tabs = [
    { to: "/gatekeeper", label: "Live Requests", icon: ListChecks, exact: true },
    { to: "/gatekeeper/returns", label: "Returns", icon: RotateCcw, exact: false },
  ];
  return (
    <div className="h-screen overflow-hidden bg-background flex flex-col">
      <header className="bg-primary text-primary-foreground px-6 py-3 flex items-center justify-between shrink-0">
        <div>
          <div className="text-xs opacity-80">{t("gk.title")}</div>
          <div className="font-semibold">{profile?.full_name}</div>
        </div>
        <div className="flex items-center gap-2">
          <GateStatusIndicator />
          <LanguageSwitcher />
          <button onClick={async () => { await signOut(); nav({ to: "/secure/gate-access" }); }} className="p-2 rounded hover:bg-white/10" aria-label={t("nav.signout")}>
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div className="bg-card border-b border-border px-4 sm:px-6 shrink-0">
        <div className="max-w-7xl mx-auto flex gap-1 overflow-x-auto">
          {tabs.map((tt) => {
            const active = tt.exact ? loc.pathname === tt.to : loc.pathname.startsWith(tt.to);
            const Icon = tt.icon;
            return (
              <Link key={tt.to} to={tt.to}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                <Icon className="h-4 w-4" /> {tt.label}
              </Link>
            );
          })}
        </div>
      </div>
      <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full flex-1 min-h-0 overflow-y-auto scrollbar-hidden">
        <Outlet />
      </main>
    </div>
  );
}
