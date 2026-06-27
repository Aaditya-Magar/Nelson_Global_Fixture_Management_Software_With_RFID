import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/worker/requests")({
  component: WorkerRequests,
});

type Req = {
  id: string;
  status: "pending" | "preparing" | "ready" | "collected" | "cancelled";
  created_at: string;
  collected_at: string | null;
  returned_at?: string | null;
  return_status?: string | null;
  notes: string | null;
  gate_status?: string | null;
  request_items: { id: string; fixtures: { fixture_id: string; name: string; customer_no: string | null; ngp_no: string | null } | null }[];
  collector?: { full_name: string } | null;
};

const STEPS = ["pending", "preparing", "ready", "collected"] as const;
const ONE_HOUR_MS = 60 * 60 * 1000;

function WorkerRequests() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const [reqs, setReqs] = useState<Req[]>([]);

  useEffect(() => {
    if (!profile) return;
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from("requests")
        .select("id,status,created_at,collected_at,returned_at,return_status,notes,gate_status,request_items(id,fixtures(fixture_id,name,customer_no,ngp_no))")
        .eq("worker_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (active) setReqs((data as unknown as Req[]) ?? []);
    };
    load();
    const ch = supabase.channel(`worker-reqs-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "requests", filter: `worker_id=eq.${profile.id}` }, load)
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, [profile]);

  const cancel = async (id: string) => {
    if (!confirm(t("worker.cancel_confirm"))) return;
    const { data, error } = await supabase
      .from("requests")
      .update({ status: "cancelled" })
      .eq("id", id)
      .select("id");
    if (error) { toast.error(`Could not cancel: ${error.message}`); return; }
    if (!data || data.length === 0) {
      toast.error("Cancel blocked — gatekeeper has already started preparing. Ask them to stop first.");
      return;
    }
    toast.success("Request cancelled");
  };

  // Hide "collected" requests older than 1 hour and "cancelled" older than 1 hour
  const visible = reqs.filter((r) => {
    if (r.status === "collected") {
      const ref = r.returned_at ?? r.collected_at ?? r.created_at;
      return Date.now() - new Date(ref).getTime() < ONE_HOUR_MS;
    }
    if (r.status === "cancelled") {
      return Date.now() - new Date(r.created_at).getTime() < ONE_HOUR_MS;
    }
    return true;
  });

  if (visible.length === 0) {
    return <div className="text-center py-16 text-muted-foreground">{t("worker.no_requests")}</div>;
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">{t("worker.my_requests")}</h1>
      {visible.map((r) => {
        const stepIdx = STEPS.indexOf(r.status as (typeof STEPS)[number]);
        const isReady = r.status === "ready";
        const isCancelled = r.status === "cancelled";
        const canCancel = r.status === "pending" || r.status === "preparing";
        const isReturned = r.return_status === "returned" || !!r.returned_at;
        return (
          <div key={r.id} className={`rounded-xl border bg-card p-4 ${isReady ? "border-green-500 ready-pulse" : "border-border"}`}>
            <div className="flex justify-between items-start mb-2">
              <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
              <StatusBadge status={r.status} />
            </div>
            <div className="text-sm space-y-1">
              {r.request_items.map((it) => (
                <div key={it.id}>
                  <div className="truncate">• {it.fixtures?.name ?? "—"} <span className="font-mono text-xs text-muted-foreground">{it.fixtures?.fixture_id}</span></div>
                  <div className="text-xs text-muted-foreground pl-3">Customer No.: {it.fixtures?.customer_no || "—"} · NGP: {it.fixtures?.ngp_no || "—"}</div>
                </div>
              ))}
            </div>
            {!isCancelled && (
              <div className="mt-3 flex items-center gap-1">
                {STEPS.map((s, i) => (
                  <div key={s} className="flex-1 flex items-center gap-1">
                    <div className={`h-2 w-2 rounded-full ${i <= stepIdx ? "bg-primary" : "bg-muted"}`} />
                    {i < STEPS.length - 1 && <div className={`h-px flex-1 ${i < stepIdx ? "bg-primary" : "bg-muted"}`} />}
                  </div>
                ))}
              </div>
            )}
            {isReady && (
              <div className="mt-2 text-sm font-medium text-green-700">{t("worker.ready_msg")}</div>
            )}
            {r.status === "collected" && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {isReturned ? (
                  <span className="px-2 py-1 rounded bg-green-100 text-green-800 font-semibold">
                    ✓ Returned {r.returned_at ? `at ${new Date(r.returned_at).toLocaleTimeString()}` : ""}
                  </span>
                ) : (
                  <span className="px-2 py-1 rounded bg-gray-100 text-gray-700 font-semibold">Fixture with you</span>
                )}
                {r.collected_at && <span className="text-muted-foreground">Collected: {new Date(r.collected_at).toLocaleString()}</span>}
              </div>
            )}
            {canCancel && (
              <button onClick={() => cancel(r.id)} className="mt-3 text-xs text-destructive font-medium">{t("worker.cancel")}</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: Req["status"] }) {
  const map: Record<Req["status"], string> = {
    pending: "bg-amber-100 text-amber-800",
    preparing: "bg-blue-100 text-blue-800",
    ready: "bg-green-100 text-green-800",
    collected: "bg-gray-100 text-gray-700",
    cancelled: "bg-gray-100 text-gray-500",
  };
  return <span className={`text-[10px] uppercase font-semibold px-2 py-1 rounded ${map[status]}`}>{status}</span>;
}
