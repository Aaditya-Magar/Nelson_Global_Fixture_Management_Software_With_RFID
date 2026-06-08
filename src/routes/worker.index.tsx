import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { ChevronRight, Package, Clock, AlertCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/worker/")({
  component: WorkerHome,
});

function WorkerHome() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const [withMe, setWithMe] = useState(0);
  const [pending, setPending] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!profile) return;
    let active = true;
    const load = async () => {
      const [withMeRes, pendingRes, readyRes] = await Promise.all([
        supabase.from("transactions").select("id", { count: "exact", head: true })
          .eq("worker_id", profile.id).eq("status", "active"),
        supabase.from("requests").select("id", { count: "exact", head: true })
          .eq("worker_id", profile.id).in("status", ["pending", "preparing"]),
        supabase.from("requests").select("id").eq("worker_id", profile.id).eq("status", "ready").limit(1),
      ]);
      if (!active) return;
      setWithMe(withMeRes.count ?? 0);
      setPending(pendingRes.count ?? 0);
      setReady(!!(readyRes.data && readyRes.data.length));
    };
    load();
    const ch = supabase.channel(`worker-home-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "requests", filter: `worker_id=eq.${profile.id}` }, load)
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, [profile]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("worker.hello")}, {profile?.full_name?.split(" ")[0]}</h1>
        <p className="text-sm text-muted-foreground">{profile?.department ?? "—"}</p>
      </div>

      {ready && (
        <Link
          to="/worker/requests"
          className="block ready-pulse rounded-xl bg-green-600 text-white px-4 py-4 shadow"
        >
          <div className="font-semibold flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            {t("worker.ready_banner")}
          </div>
          <div className="text-sm opacity-90 mt-1">{t("worker.ready_subtitle")}</div>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={Package} label={t("worker.with_me")} value={withMe} />
        <StatCard icon={Clock} label={t("worker.pending")} value={pending} />
      </div>

      <Link
        to="/worker/search"
        className="block rounded-xl bg-card border border-border px-4 py-4 hover:border-primary/30 transition"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">{t("worker.find_fixture")}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{t("worker.find_subtitle")}</div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </div>
      </Link>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number }) {
  return (
    <div className="rounded-xl bg-card border border-border p-4">
      <Icon className="h-5 w-5 text-primary" />
      <div className="text-3xl font-bold mt-2">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
