import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { GateStatusIndicator } from "@/components/GateStatusIndicator";

type GateRow = {
  id: string;
  created_at: string;
  scan_1_verified: boolean;
  scan_2_verified: boolean;
  gate_opened: boolean;
  executed: boolean;
  failure_reason: string | null;
  worker: { full_name: string; employee_id: string } | null;
  fixtures: { fixture_id: string; name: string } | null;
  gatekeeper: { full_name: string } | null;
};

export function GateActivity() {
  const [rows, setRows] = useState<GateRow[]>([]);
  const [dateFilter, setDateFilter] = useState<string>("");
  const [resultFilter, setResultFilter] = useState<"all" | "opened" | "failed">("all");
  const [workerFilter, setWorkerFilter] = useState<string>("");

  const load = async () => {
    const { data } = await supabase
      .from("gate_log")
      .select("id,created_at,scan_1_verified,scan_2_verified,gate_opened,executed,failure_reason,worker:profiles!gate_log_worker_id_fkey(full_name,employee_id),fixtures(fixture_id,name),gatekeeper:profiles!gate_log_gatekeeper_id_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(500);
    setRows((data as unknown as GateRow[]) ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("admin-gate-log")
      .on("postgres_changes", { event: "*", schema: "public", table: "gate_log" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => rows.filter((r) => {
    if (dateFilter && !r.created_at.startsWith(dateFilter)) return false;
    if (resultFilter === "opened" && !r.gate_opened) return false;
    if (resultFilter === "failed" && r.gate_opened) return false;
    if (workerFilter && !(r.worker?.full_name ?? "").toLowerCase().includes(workerFilter.toLowerCase())) return false;
    return true;
  }), [rows, dateFilter, resultFilter, workerFilter]);

  const today = new Date(); today.setHours(0,0,0,0);
  const todays = rows.filter((r) => new Date(r.created_at) >= today);
  const opensToday = todays.filter((r) => r.gate_opened).length;
  const failsToday = todays.filter((r) => !r.gate_opened && r.failure_reason).length;

  const exportCsv = () => {
    const header = "time,worker,employee_id,fixture_id,fixture_name,gatekeeper,scan1,scan2,gate_opened,failure_reason\n";
    const body = filtered.map((r) => [
      new Date(r.created_at).toISOString(),
      r.worker?.full_name ?? "",
      r.worker?.employee_id ?? "",
      r.fixtures?.fixture_id ?? "",
      r.fixtures?.name ?? "",
      r.gatekeeper?.full_name ?? "",
      r.scan_1_verified ? "Y" : "N",
      r.scan_2_verified ? "Y" : "N",
      r.gate_opened ? "Y" : "N",
      (r.failure_reason ?? "").replace(/,/g, ";"),
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `gate-activity-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Gate Status</div>
          <div className="mt-2"><GateStatusIndicator /></div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Opens Today</div>
          <div className="mt-1 text-2xl font-semibold text-green-600">{opensToday}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Failed Attempts Today</div>
          <div className="mt-1 text-2xl font-semibold text-red-600">{failsToday}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="text-xs text-muted-foreground block">Date</label>
          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
            className="rounded-md bg-background border border-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block">Worker</label>
          <input value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)} placeholder="Search worker"
            className="rounded-md bg-background border border-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block">Result</label>
          <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value as "all" | "opened" | "failed")}
            className="rounded-md bg-background border border-border px-3 py-2 text-sm">
            <option value="all">All</option>
            <option value="opened">Opened</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <button onClick={exportCsv} className="ml-auto flex items-center gap-1 text-xs px-3 py-2 rounded bg-primary text-primary-foreground">
          <Download className="h-3 w-3" /> Export CSV
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-secondary text-secondary-foreground">
            <tr>
              <th className="text-left p-2">Time</th>
              <th className="text-left p-2">Worker</th>
              <th className="text-left p-2">Fixture</th>
              <th className="text-left p-2">Gatekeeper</th>
              <th className="text-left p-2">Scan 1</th>
              <th className="text-left p-2">Scan 2</th>
              <th className="text-left p-2">Gate</th>
              <th className="text-left p-2">Failure</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="p-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</td>
                <td className="p-2">{r.worker?.full_name ?? "—"}</td>
                <td className="p-2">
                  <div className="font-mono">{r.fixtures?.fixture_id ?? "—"}</div>
                  <div className="text-muted-foreground">{r.fixtures?.name ?? ""}</div>
                </td>
                <td className="p-2">{r.gatekeeper?.full_name ?? "—"}</td>
                <td className="p-2">{r.scan_1_verified ? "✓" : "✗"}</td>
                <td className="p-2">{r.scan_2_verified ? "✓" : "✗"}</td>
                <td className="p-2">{r.gate_opened ? "✓" : "✗"}</td>
                <td className="p-2 text-muted-foreground">{r.failure_reason ?? ""}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">No gate activity yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
