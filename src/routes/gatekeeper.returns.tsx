import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, MapPin, Package, RotateCcw, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { sanitizeText } from "@/lib/sanitize";
import { playSoftBeep, playErrorSound, playReturnSuccessSound } from "@/lib/gate-audio";
import { FIXTURE_LOCATION_SELECT, locationPathText, type FixtureWithLocation } from "@/lib/fixtures";
import { DualScanInput } from "@/components/DualScanInput";

export const Route = createFileRoute("/gatekeeper/returns")({
  component: GatekeeperReturns,
});

type CheckedOutRow = {
  id: string;                       // transaction id
  checked_out_at: string;
  fixture_id: string;               // fixture uuid
  request_id: string | null;
  fixtures: FixtureWithLocation | null;
  worker: { id: string; full_name: string; employee_id: string } | null;
};

const ACTIVE_TRANSACTION_SELECT =
  `id,checked_out_at,fixture_id,request_id,fixtures!inner(${FIXTURE_LOCATION_SELECT}),worker:profiles!transactions_worker_id_fkey(id,full_name,employee_id)`;

type ScanState =
  | { kind: "idle" }
  | { kind: "success"; row: CheckedOutRow; durationMs: number; rackName: string; rowName: string }
  | { kind: "not_checked_out"; fx: { fixture_id: string; name: string } }
  | { kind: "not_found"; scanned: string };

type ScanStatus = "idle" | "scanning" | "success" | "error";
type StepKey = "rack" | "row" | "fixture";
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function durationText(ms: number): { text: string; level: "ok" | "warn" | "over" } {
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const text = h > 0 ? `${h}h ${m}m` : `${m}m`;
  const level: "ok" | "warn" | "over" = mins < 240 ? "ok" : mins < 480 ? "warn" : "over";
  return { text, level };
}

function GatekeeperReturns() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<CheckedOutRow[]>([]);
  const [scan, setScan] = useState<ScanState>({ kind: "idle" });
  const [q, setQ] = useState("");
  const [, tick] = useState(0);
  const [todays, setTodays] = useState<Array<{ id: string; returned_at: string; fixture_id: string; fixture_name: string; worker_name: string; duration: string }>>([]);
  const [step, setStep] = useState<StepKey>("rack");
  const [stepStates, setStepStates] = useState<Record<StepKey, { status: ScanStatus; message: string }>>({
    rack: { status: "idle", message: "" },
    row: { status: "idle", message: "" },
    fixture: { status: "idle", message: "" },
  });
  const [confirmedRack, setConfirmedRack] = useState<{ id: string; name: string } | null>(null);
  const [confirmedRow, setConfirmedRow] = useState<{ id: string; name: string; rack_id: string } | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("transactions")
      .select(ACTIVE_TRANSACTION_SELECT)
      .eq("status", "active")
      .order("checked_out_at", { ascending: true });
    setRows((data as unknown as CheckedOutRow[]) ?? []);
  };

  const loadTodaysReturns = async () => {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("transactions")
      .select("id,checked_out_at,returned_at,fixtures(fixture_id,name),worker:profiles!transactions_worker_id_fkey(full_name)")
      .eq("status", "returned")
      .gte("returned_at", since.toISOString())
      .order("returned_at", { ascending: false })
      .limit(30);
    type R = { id: string; checked_out_at: string; returned_at: string; fixtures: { fixture_id: string; name: string } | null; worker: { full_name: string } | null };
    setTodays(((data as unknown as R[]) ?? []).map((r) => {
      const ms = new Date(r.returned_at).getTime() - new Date(r.checked_out_at).getTime();
      return {
        id: r.id,
        returned_at: r.returned_at,
        fixture_id: r.fixtures?.fixture_id ?? "—",
        fixture_name: r.fixtures?.name ?? "—",
        worker_name: r.worker?.full_name ?? "—",
        duration: durationText(ms).text,
      };
    }));
  };

  useEffect(() => {
    load(); loadTodaysReturns();
    const ch = supabase.channel("gk-returns")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => { load(); loadTodaysReturns(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "fixtures" }, load)
      .subscribe();
    const t = setInterval(() => tick((n) => n + 1), 60000); // refresh durations
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const sorted = [...rows].sort((a, b) => new Date(a.checked_out_at).getTime() - new Date(b.checked_out_at).getTime());
    if (!term) return sorted;
    return sorted.filter((r) => {
      const hay = `${r.fixtures?.fixture_id ?? ""} ${r.fixtures?.name ?? ""} ${r.fixtures?.customer_no ?? ""} ${r.fixtures?.ngp_no ?? ""} ${r.worker?.full_name ?? ""} ${r.worker?.employee_id ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
  }, [rows, q]);

  const resetScanner = (delayMs = 2000) => {
    setTimeout(() => {
      setScan({ kind: "idle" });
      setStep("rack");
      setConfirmedRack(null);
      setConfirmedRow(null);
      setStepStates({
        rack: { status: "idle", message: "" },
        row: { status: "idle", message: "" },
        fixture: { status: "idle", message: "" },
      });
    }, delayMs);
  };

  const processReturn = async (row: CheckedOutRow, rackName: string, rowName: string) => {
    if (!profile) return;
    const now = new Date().toISOString();
    // Update transaction
    await supabase.from("transactions").update({
      status: "returned",
      returned_at: now,
      return_scanned_at: now,
      return_processed_by: profile.id,
    }).eq("id", row.id);

    const { count: remainingActive } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("fixture_id", row.fixture_id)
      .eq("status", "active");

    // Restore availability only when this was the last active checkout for the fixture.
    if ((remainingActive ?? 0) === 0) {
      await supabase.from("fixtures").update({ status: "available" }).eq("id", row.fixture_id);
      const { data: fx } = await supabase.from("fixtures").select("home_slot_id").eq("id", row.fixture_id).maybeSingle();
      if (fx && (fx as { home_slot_id: string | null }).home_slot_id) {
        await supabase.from("fixtures").update({ current_slot_id: (fx as { home_slot_id: string }).home_slot_id }).eq("id", row.fixture_id);
        await supabase.from("slots").update({ is_occupied: true }).eq("id", (fx as { home_slot_id: string }).home_slot_id);
      }
    } else {
      await supabase.from("fixtures").update({ status: "checked_out" }).eq("id", row.fixture_id);
    }
    // Update request (best effort)
    if (row.request_id) {
      await supabase.from("requests").update({ return_status: "returned", returned_at: now }).eq("id", row.request_id);
    }
    // Log
    await supabase.from("return_log").insert({
      fixture_id: row.fixture_id,
      worker_id: row.worker?.id ?? null,
      gatekeeper_id: profile.id,
      transaction_id: row.id,
      scanned_fixture_id: row.fixtures?.fixture_id ?? "",
      return_verified: true,
    });
    const ms = Date.now() - new Date(row.checked_out_at).getTime();
    setScan({ kind: "success", row, durationMs: ms, rackName, rowName });
    playReturnSuccessSound();
    resetScanner(3000);
  };

  const setStepState = (key: StepKey, status: ScanStatus, message: string) => {
    setStepStates((old) => ({ ...old, [key]: { status, message } }));
  };

  const clearErrorLater = (key: StepKey) => {
    setTimeout(() => setStepStates((old) => old[key].status === "error" ? { ...old, [key]: { status: "idle", message: "" } } : old), 2000);
  };

  const findRack = async (value: string) => {
    if (uuidRe.test(value)) {
      const { data } = await supabase.from("racks").select("id,name,nfc_tag_id").eq("id", value).maybeSingle();
      if (data) return data as { id: string; name: string; nfc_tag_id: string | null };
    }
    const { data } = await supabase.from("racks").select("id,name,nfc_tag_id").eq("nfc_tag_id", value).maybeSingle();
    return data as { id: string; name: string; nfc_tag_id: string | null } | null;
  };

  const findRow = async (value: string) => {
    if (uuidRe.test(value)) {
      const { data } = await supabase.from("rows").select("id,name,rack_id,nfc_tag_id").eq("id", value).maybeSingle();
      if (data) return data as { id: string; name: string; rack_id: string; nfc_tag_id: string | null };
    }
    const { data } = await supabase.from("rows").select("id,name,rack_id,nfc_tag_id").eq("nfc_tag_id", value).maybeSingle();
    return data as { id: string; name: string; rack_id: string; nfc_tag_id: string | null } | null;
  };

  const handleRack = async (raw: string) => {
    const code = sanitizeText(raw, 120).trim();
    const rack = await findRack(code);
    if (!rack) {
      setStepState("rack", "error", "Label not recognized as a rack - please try again");
      playErrorSound();
      clearErrorLater("rack");
      return;
    }
    setConfirmedRack({ id: rack.id, name: rack.name });
    setStepState("rack", "success", `${rack.name} confirmed`);
    setStep("row");
    playSoftBeep();
  };

  const handleRow = async (raw: string) => {
    const code = sanitizeText(raw, 120).trim();
    const row = await findRow(code);
    if (!row) {
      setStepState("row", "error", "Label not recognized as a row - please try again");
      playErrorSound();
      clearErrorLater("row");
      return;
    }
    if (confirmedRack && row.rack_id !== confirmedRack.id) {
      setStepState("row", "error", `This row is not in ${confirmedRack.name} - please scan a row in the correct rack`);
      playErrorSound();
      clearErrorLater("row");
      return;
    }
    setConfirmedRow({ id: row.id, name: row.name, rack_id: row.rack_id });
    setStepState("row", "success", `${row.name} confirmed`);
    setStep("fixture");
    playSoftBeep();
  };

  const handleFixture = async (raw: string) => {
    if (!profile) return;
    const code = sanitizeText(raw, 100).trim();
    if (!code) return;
    const byCode = await supabase.from("fixtures").select("id,fixture_id,name,status").eq("fixture_id", code).maybeSingle();
    const byNfc = byCode.data ? { data: null } : await supabase.from("fixtures").select("id,fixture_id,name,status").eq("nfc_tag_id", code).maybeSingle();
    const fx = byCode.data || byNfc.data;
    if (!fx) {
      await supabase.from("return_log").insert({
        scanned_fixture_id: code,
        gatekeeper_id: profile.id,
        return_verified: false,
        failure_reason: "fixture_not_found",
      });
      setScan({ kind: "not_found", scanned: code });
      setStepState("fixture", "error", "Label not recognized as a fixture");
      playErrorSound();
      clearErrorLater("fixture");
      return;
    }
    const fxRow = fx as { id: string; fixture_id: string; name: string; status: string };
    let row = rows.find((r) => r.fixture_id === fxRow.id) ?? null;
    if (!row) {
      const { data: activeTx } = await supabase
        .from("transactions")
        .select(ACTIVE_TRANSACTION_SELECT)
        .eq("fixture_id", fxRow.id)
        .eq("status", "active")
        .order("checked_out_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      row = (activeTx as unknown as CheckedOutRow | null) ?? null;
    }

    if (!row) {
      await supabase.from("return_log").insert({
        fixture_id: fxRow.id,
        scanned_fixture_id: code,
        gatekeeper_id: profile.id,
        return_verified: false,
        failure_reason: "fixture_not_checked_out",
      });
      setScan({ kind: "not_checked_out", fx: fxRow });
      setStepState("fixture", "error", "This fixture is not currently checked out");
      playErrorSound();
      clearErrorLater("fixture");
      return;
    }
    if (!confirmedRack || !confirmedRow) return;
    setStepState("fixture", "success", `${row.fixtures?.name ?? fxRow.name} confirmed`);
    await processReturn(row, confirmedRack.name, confirmedRow.name);
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4 lg:gap-6 h-full min-h-0 min-w-0 overflow-x-hidden">
      {/* LEFT — Currently Checked Out */}
      <section className="min-w-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="min-w-0 font-semibold flex items-center gap-2">
            <Package className="h-4 w-4" /> Fixtures Currently Out
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-semibold">{rows.length}</span>
          </h2>
        </div>
        <div className="relative mb-3">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fixture, model, worker…"
            className="w-full pl-9 pr-3 py-2 rounded-md bg-background border border-border text-sm" />
        </div>
        <div className="space-y-2 max-h-none lg:max-h-[calc(100vh-17rem)] overflow-y-auto scrollbar-hidden lg:pr-1">
          {filtered.length === 0 && (
            <div className="text-center py-10 text-sm text-muted-foreground rounded-xl border border-dashed border-border">
              <CheckCircle2 className="h-8 w-8 mx-auto text-green-500 mb-2" />
              All fixtures are currently in stock — nothing to return
            </div>
          )}
          {filtered.map((r) => {
            const ms = Date.now() - new Date(r.checked_out_at).getTime();
            const d = durationText(ms);
            const dur = d.level === "over" ? "text-red-600" : d.level === "warn" ? "text-amber-600" : "text-muted-foreground";
            const dot = d.level === "over" ? "bg-red-500" : d.level === "warn" ? "bg-amber-500" : "bg-gray-400";
            return (
              <div key={r.id}
                className={`rounded-xl border border-border bg-card p-3 ${d.level === "over" ? "bg-red-50/40" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 break-words font-mono text-xs text-muted-foreground">{r.fixtures?.fixture_id}</div>
                  <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-red-100 text-red-800">Checked Out</span>
                </div>
                <div className="font-medium text-sm mt-0.5 break-words">{r.fixtures?.name}</div>
                <div className="text-xs text-muted-foreground">Customer No.: {r.fixtures?.customer_no || "—"} · NGP: {r.fixtures?.ngp_no || "—"}</div>
                <div className="text-xs text-muted-foreground flex items-start gap-1 mt-1"><MapPin className="h-3 w-3 mt-0.5 shrink-0" /> <span className="min-w-0 break-words">{locationPathText(r.fixtures) ?? "—"}</span></div>
                <div className="mt-2 text-xs break-words">👤 {r.worker?.full_name} ({r.worker?.employee_id})</div>
                <div className="mt-1 text-xs flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${dot}`} />
                  <span className={dur}>Out for {d.text}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* RIGHT — Scanner */}
      <section className="min-w-0 space-y-4">
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
          <h3 className="font-semibold text-sm flex items-center gap-2 mb-3"><RotateCcw className="h-4 w-4 text-primary" /> Return Scanner</h3>

          <div className="mb-3 text-xs text-muted-foreground">Confirm the storage rack, row, then fixture being returned</div>

          <ReturnStepCard title="Return Step 1 - Scan Rack" active={step === "rack"} locked={false} doneText={stepStates.rack.status === "success" ? stepStates.rack.message : ""}>
            <DualScanInput
              label="Rack Scan"
              instruction="Scan the rack where you are storing the fixture"
              active={step === "rack"}
              onScanResult={handleRack}
              status={stepStates.rack.status}
              successMessage={stepStates.rack.message}
              errorMessage={stepStates.rack.message}
            />
          </ReturnStepCard>

          <ReturnStepCard title="Return Step 2 - Scan Row" active={step === "row"} locked={!confirmedRack} doneText={stepStates.row.status === "success" ? stepStates.row.message : ""}>
            <DualScanInput
              label="Row Scan"
              instruction="Scan the row where you are placing the fixture"
              active={step === "row"}
              onScanResult={handleRow}
              status={stepStates.row.status}
              successMessage={stepStates.row.message}
              errorMessage={stepStates.row.message}
              disabled={!confirmedRack}
            />
          </ReturnStepCard>

          <ReturnStepCard title="Return Step 3 - Scan Fixture" active={step === "fixture"} locked={!confirmedRow} doneText="">
            <DualScanInput
              label="Fixture Scan"
              instruction="Scan the fixture being returned"
              active={step === "fixture"}
              onScanResult={handleFixture}
              status={stepStates.fixture.status}
              successMessage={stepStates.fixture.message}
              errorMessage={stepStates.fixture.message}
              disabled={!confirmedRow}
            />
          </ReturnStepCard>

          {scan.kind === "success" && (
            <div className="mt-3 rounded-md bg-green-50 border-2 border-green-500 text-green-900 p-4">
              <div className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-5 w-5" /> RETURN CONFIRMED</div>
              <div className="font-mono text-xs mt-2">{scan.row.fixtures?.fixture_id}</div>
              <div className="font-semibold">{scan.row.fixtures?.name}</div>
              <div className="text-xs">Customer No.: {scan.row.fixtures?.customer_no || "—"} · NGP: {scan.row.fixtures?.ngp_no || "—"}</div>
              <div className="text-xs mt-1">Returned by: {scan.row.worker?.full_name} ({scan.row.worker?.employee_id})</div>
              <div className="text-xs">Stored at: {scan.rackName} - {scan.rowName}</div>
              <div className="text-xs">Was out for: {durationText(scan.durationMs).text}</div>
              <div className="mt-2 text-sm font-medium">Fixture is back in stock.</div>
            </div>
          )}
          {scan.kind === "not_checked_out" && (
            <div className="mt-3 rounded-md bg-amber-50 border-2 border-amber-500 text-amber-900 p-4">
              <div className="flex items-center gap-2 font-bold"><AlertTriangle className="h-5 w-5" /> FIXTURE NOT CHECKED OUT</div>
              <div className="font-mono text-xs mt-2">{scan.fx.fixture_id} — {scan.fx.name}</div>
              <div className="text-sm mt-2">This fixture is currently in stock. No return action taken.</div>
            </div>
          )}
          {scan.kind === "not_found" && (
            <div className="mt-3 rounded-md bg-red-50 border-2 border-red-500 text-red-900 p-4">
              <div className="flex items-center gap-2 font-bold"><XCircle className="h-5 w-5" /> FIXTURE NOT RECOGNIZED</div>
              <div className="text-sm mt-2">Scanned: <span className="font-mono">{scan.scanned}</span></div>
              <div className="text-sm mt-1">This ID does not exist in the system.</div>
            </div>
          )}
        </div>

        {/* Today's returns log */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-secondary/40">Today's returns</div>
          <div className="sm:hidden divide-y divide-border">
            {todays.length === 0 && (
              <div className="p-3 text-center text-xs text-muted-foreground">No returns yet today</div>
            )}
            {todays.map((r) => (
              <div key={r.id} className="p-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] text-muted-foreground break-words">{r.fixture_id}</div>
                    <div className="font-medium break-words">{r.fixture_name}</div>
                  </div>
                  <div className="shrink-0 text-right text-muted-foreground">
                    {new Date(r.returned_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-muted-foreground">
                  <span>Worker</span>
                  <span className="min-w-0 text-foreground break-words">{r.worker_name}</span>
                  <span>Out for</span>
                  <span className="text-foreground">{r.duration}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden sm:block overflow-x-auto scrollbar-hidden">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="bg-secondary/30">
                <tr>
                  <th className="text-left p-2">Time</th>
                  <th className="text-left p-2">Fixture</th>
                  <th className="text-left p-2">Worker</th>
                  <th className="text-left p-2">Out for</th>
                </tr>
              </thead>
              <tbody>
                {todays.length === 0 && <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">No returns yet today</td></tr>}
                {todays.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-2 whitespace-nowrap">{new Date(r.returned_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="p-2"><div className="font-mono text-[10px] text-muted-foreground">{r.fixture_id}</div><div>{r.fixture_name}</div></td>
                    <td className="p-2">{r.worker_name}</td>
                    <td className="p-2">{r.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

    </div>
  );
}

function ReturnStepCard({ title, active, locked, doneText, children }: { title: string; active: boolean; locked: boolean; doneText: string; children: React.ReactNode }) {
  if (doneText && !active) {
    return <div className="mb-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">✓ {doneText}</div>;
  }
  if (locked) {
    return <div className="mb-3 rounded-lg border border-border bg-secondary/30 px-3 py-3 text-sm text-muted-foreground">○ {title} <span className="text-xs">[locked]</span></div>;
  }
  return (
    <div className={`mb-3 rounded-lg border px-3 py-3 ${active ? "border-primary bg-primary/5" : "border-border bg-background"}`}>
      <div className="font-semibold text-sm mb-2">● {title}</div>
      {children}
    </div>
  );
}
