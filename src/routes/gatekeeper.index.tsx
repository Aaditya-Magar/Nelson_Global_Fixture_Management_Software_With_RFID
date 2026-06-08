import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Camera, Lock, MapPin, DoorOpen, X, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useZxing } from "react-zxing";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { sanitizeText } from "@/lib/sanitize";
import { toast } from "sonner";
import { FIXTURE_LOCATION_SELECT, locationPathText, type FixtureWithLocation } from "@/lib/fixtures";
import { FixtureLocationBadge } from "@/components/FixtureLocationBadge";
import { useI18n } from "@/lib/i18n";
import { playSuccessBeep, playGateOpenSound, playErrorSound } from "@/lib/gate-audio";

export const Route = createFileRoute("/gatekeeper/")({
  component: GatekeeperHome,
});

type ReqItemFx = FixtureWithLocation;
type ReqRow = {
  id: string;
  status: "pending" | "preparing" | "ready" | "collected" | "cancelled";
  notes: string | null;
  created_at: string;
  ready_at: string | null;
  gate_status?: string | null;
  worker: { id: string; full_name: string; employee_id: string; department: string | null } | null;
  request_items: { id: string; fixture_id: string; fixtures: ReqItemFx | null }[];
};

function GatekeeperHome() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const [requests, setRequests] = useState<ReqRow[]>([]);
  const [active, setActive] = useState<ReqRow | null>(null);
  const [scan1Done, setScan1Done] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await supabase
        .from("requests")
        .select(`id,status,notes,created_at,ready_at,gate_status,worker:profiles!requests_worker_id_fkey(id,full_name,employee_id,department),request_items(id,fixture_id,fixtures(${FIXTURE_LOCATION_SELECT}))`)
        .in("status", ["pending", "preparing", "ready"])
        .order("created_at", { ascending: true });
      if (alive) setRequests((data as unknown as ReqRow[]) ?? []);
    };
    load();
    const ch = supabase.channel("gk-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "requests" }, (p) => {
        if (p.eventType === "INSERT") toast("New fixture request received");
        load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "request_items" }, load)
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, []);

  const startPreparing = async (r: ReqRow) => {
    if (active && active.id !== r.id) {
      if (!confirm("You have an active request in progress. Cancel it and start new one?")) return;
    }
    if (r.status === "pending") {
      await supabase.from("requests").update({ status: "preparing" }).eq("id", r.id);
    }
    setActive(r);
    setScan1Done(false);
  };

  const cancelActive = async () => {
    if (!active) return;
    if (!confirm("Stop preparing this request? It will go back to PENDING so it can be picked up again.")) return;
    const { error } = await supabase
      .from("requests")
      .update({ status: "pending", ready_at: null, gate_status: null, verified_fixture_id: null })
      .eq("id", active.id);
    if (error) { toast.error(`Could not revert: ${error.message}`); return; }
    toast.success("Request returned to pending queue");
    setActive(null);
    setScan1Done(false);
  };

  const onScan1Match = async (fxId: string) => {
    if (!active || !profile) return;
    await supabase.from("requests").update({ gate_status: "scan1_verified", verified_fixture_id: fxId }).eq("id", active.id);
    await supabase.from("gate_log").insert({
      command: "open",
      executed: false,
      worker_id: active.worker?.id ?? null,
      fixture_id: fxId,
      request_id: active.id,
      gatekeeper_id: profile.id,
      scan_1_verified: true,
      scan_1_at: new Date().toISOString(),
    });
    setScan1Done(true);
    playSuccessBeep();
  };

  const onScan1Wrong = async (scanned: string, expectedFxId: string) => {
    if (!active || !profile) return;
    await supabase.from("requests").update({ gate_status: "scan1_failed" }).eq("id", active.id);
    await supabase.from("gate_log").insert({
      command: "open",
      executed: false,
      worker_id: active.worker?.id ?? null,
      fixture_id: expectedFxId,
      request_id: active.id,
      gatekeeper_id: profile.id,
      scan_1_verified: false,
      scan_1_at: new Date().toISOString(),
      failure_reason: `wrong_fixture_at_rack: scanned ${scanned}`,
    });
    playErrorSound();
  };

  const onGateOpen = async (fxId: string) => {
    if (!active || !profile) return;
    const [{ count: activeCheckoutCount }, { data: fixture }] = await Promise.all([
      supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("fixture_id", fxId)
        .eq("status", "active"),
      supabase.from("fixtures").select("status").eq("id", fxId).maybeSingle(),
    ]);
    if ((activeCheckoutCount ?? 0) > 0 || (fixture as { status?: string } | null)?.status !== "available") {
      await supabase.from("requests").update({ gate_status: "gate_failed" }).eq("id", active.id);
      await supabase.from("gate_log").insert({
        command: "open",
        executed: false,
        worker_id: active.worker?.id ?? null,
        fixture_id: fxId,
        request_id: active.id,
        gatekeeper_id: profile.id,
        scan_1_verified: true,
        scan_2_verified: true,
        scan_2_at: new Date().toISOString(),
        gate_opened: false,
        failure_reason: "fixture_already_checked_out",
      });
      toast.error("Fixture is already checked out. Return it before opening the gate again.");
      playErrorSound();
      return;
    }
    await supabase.from("gate_log").insert({
      command: "open",
      executed: false,
      worker_id: active.worker?.id ?? null,
      fixture_id: fxId,
      request_id: active.id,
      gatekeeper_id: profile.id,
      scan_1_verified: true,
      scan_2_verified: true,
      scan_2_at: new Date().toISOString(),
      gate_opened: true,
      gate_opened_at: new Date().toISOString(),
    });
    await supabase.from("transactions").insert({
      fixture_id: fxId, worker_id: active.worker?.id ?? null,
      gatekeeper_id: profile.id, request_id: active.id, status: "active",
    });
    await supabase.from("fixtures").update({ status: "checked_out" }).eq("id", fxId);
    await supabase.from("requests").update({ status: "collected", gate_status: "gate_opened", collected_at: new Date().toISOString() }).eq("id", active.id);
    playGateOpenSound();
    setTimeout(() => { setActive(null); setScan1Done(false); }, 10000);
  };

  const onGateWrong = async (scanned: string, expectedFxId: string) => {
    if (!active || !profile) return;
    await supabase.from("requests").update({ gate_status: "gate_failed" }).eq("id", active.id);
    await supabase.from("gate_log").insert({
      command: "open",
      executed: false,
      worker_id: active.worker?.id ?? null,
      fixture_id: expectedFxId,
      request_id: active.id,
      gatekeeper_id: profile.id,
      scan_1_verified: true,
      scan_2_verified: false,
      scan_2_at: new Date().toISOString(),
      gate_opened: false,
      failure_reason: `wrong_fixture_at_gate: scanned ${scanned}`,
    });
    playErrorSound();
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <section>
        <h2 className="font-semibold mb-3">{t("gk.queue")}</h2>
        <div className="space-y-3">
          {requests.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">{t("gk.no_active")}</div>}
          {requests.map((r) => (
            <QueueCard key={r.id} req={r} isActive={active?.id === r.id} onStart={() => startPreparing(r)} />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <ActiveRequestCard req={active} scan1Done={scan1Done} onCancel={cancelActive} />
        <ScanStation1
          active={active}
          onMatch={onScan1Match}
          onWrong={onScan1Wrong}
          done={scan1Done}
        />
        <ScanStation2
          active={active}
          unlocked={scan1Done}
          onMatch={onGateOpen}
          onWrong={onGateWrong}
        />
      </section>
    </div>
  );
}

function QueueCard({ req, isActive, onStart }: { req: ReqRow; isActive: boolean; onStart: () => void }) {
  const { t } = useI18n();
  const elapsed = Math.round((Date.now() - new Date(req.created_at).getTime()) / 60000);
  return (
    <div className={`rounded-xl border p-4 ${isActive ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
      <div className="flex justify-between items-start gap-3">
        <div>
          <div className="font-medium">{req.worker?.full_name}</div>
          <div className="text-xs text-muted-foreground">{req.worker?.employee_id} · {req.worker?.department ?? "—"}</div>
        </div>
        <span className="text-[10px] uppercase font-semibold px-2 py-1 rounded bg-secondary text-secondary-foreground">{req.status}</span>
      </div>
      <ul className="mt-3 space-y-1">
        {req.request_items.map((i) => i.fixtures && (
          <li key={i.id} className="text-xs">
            <span className="font-mono text-muted-foreground">{i.fixtures.fixture_id}</span>
            <span className="ml-2">{i.fixtures.name}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{elapsed}m ago</div>
        <button onClick={onStart} className={`text-xs font-medium px-3 py-1.5 rounded ${isActive ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"}`}>
          {isActive ? "Active" : t("gk.start_preparing")}
        </button>
      </div>
    </div>
  );
}

function ActiveRequestCard({ req, scan1Done, onCancel }: { req: ReqRow | null; scan1Done: boolean; onCancel: () => void }) {
  if (!req) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Select a request from the queue to begin
      </div>
    );
  }
  const elapsed = Math.round((Date.now() - new Date(req.created_at).getTime()) / 60000);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">Active Request</h3>
          <span className="text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-semibold">{elapsed}m ago</span>
        </div>
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1">
          <X className="h-3 w-3" /> Cancel
        </button>
      </div>
      <div className="mt-2 text-sm">
        <div className="font-medium">{req.worker?.full_name}</div>
        <div className="text-xs text-muted-foreground">{req.worker?.employee_id} · {req.worker?.department ?? "—"}</div>
      </div>
      <ul className="mt-3 space-y-2">
        {req.request_items.map((i) => i.fixtures && (
          <li key={i.id} className="rounded-md border border-border p-2">
            <div className="font-mono text-xs text-muted-foreground">{i.fixtures.fixture_id}</div>
            <div className="text-sm font-medium">{i.fixtures.name}</div>
            <div className="text-xs text-muted-foreground">Model: {i.fixtures.model_number || "—"}</div>
            <FixtureLocationBadge current_slot={i.fixtures.current_slot} className="mt-1" />
          </li>
        ))}
      </ul>
      <ol className="mt-3 space-y-1.5 text-xs">
        <li className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${scan1Done ? "bg-green-500" : "bg-blue-500 animate-pulse"}`} />
          <span className={scan1Done ? "text-muted-foreground line-through" : "font-medium"}>Step 1: Go to rack and scan fixture</span>
        </li>
        <li className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${scan1Done ? "bg-blue-500 animate-pulse" : "bg-gray-300"}`} />
          <span className={scan1Done ? "font-medium" : "text-muted-foreground"}>Step 2: Walk to gate and scan to open</span>
        </li>
      </ol>
    </div>
  );
}

// ====== Shared scan-input behavior ======
function useScanInput(opts: {
  enabled: boolean;
  onSubmit: (value: string) => void;
  clearAfterMs?: number;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (opts.enabled) ref.current?.focus();
  }, [opts.enabled]);

  const submit = (raw: string) => {
    const v = sanitizeText(raw, 100).trim();
    if (!v) return;
    opts.onSubmit(v);
  };

  return {
    value, setValue, ref,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") { e.preventDefault(); submit(value); setValue(""); }
    },
    clearAndRefocus: () => {
      setTimeout(() => { setValue(""); ref.current?.focus(); }, opts.clearAfterMs ?? 2000);
    },
    submitNow: (v: string) => submit(v),
  };
}

function CameraScanModal({ onClose, onResult }: { onClose: () => void; onResult: (text: string) => void }) {
  const handled = useRef(false);
  const { ref } = useZxing({
    onDecodeResult: (r) => { if (handled.current) return; handled.current = true; onResult(r.getText()); },
  });
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      <button onClick={onClose} className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 text-white" aria-label="Close">
        <X className="h-5 w-5" />
      </button>
      <video ref={ref} className="flex-1 w-full object-cover" />
      <div className="text-center text-white/80 text-sm pb-6">Point camera at barcode / QR</div>
    </div>
  );
}

// ====== Station 1 ======
function ScanStation1({ active, onMatch, onWrong, done }: {
  active: ReqRow | null;
  onMatch: (fxId: string) => void;
  onWrong: (scanned: string, expectedFxId: string) => void;
  done: boolean;
}) {
  type Result =
    | { kind: "ok"; fx: FixtureWithLocation }
    | { kind: "wrong"; scanned: string; expectedCode: string; expectedName: string; scannedFx?: FixtureWithLocation | null }
    | { kind: "no-active" }
    | null;
  const [result, setResult] = useState<Result>(null);
  const [cam, setCam] = useState(false);

  const expected = active?.request_items.find((i) => i.fixtures)?.fixtures ?? null;

  const handle = async (value: string) => {
    if (!active || !expected) { setResult({ kind: "no-active" }); playErrorSound(); return; }
    if (done) return;
    const code = value.trim();
    const { data: fx } = await supabase
      .from("fixtures")
      .select(FIXTURE_LOCATION_SELECT)
      .eq("fixture_id", code)
      .maybeSingle();
    const scannedFx = (fx as unknown as FixtureWithLocation | null) ?? null;
    if (scannedFx && scannedFx.id === expected.id) {
      setResult({ kind: "ok", fx: scannedFx });
      onMatch(scannedFx.id);
    } else {
      setResult({ kind: "wrong", scanned: code, expectedCode: expected.fixture_id, expectedName: expected.name, scannedFx });
      onWrong(code, expected.id);
      input.clearAndRefocus();
    }
  };

  const input = useScanInput({ enabled: !!active && !done, onSubmit: handle });

  // reset result when active changes
  useEffect(() => { setResult(null); }, [active?.id]);

  const borderCls = done ? "border-green-500" : result?.kind === "wrong" ? "border-red-500" : "border-border";

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <MapPin className="h-4 w-4 text-amber-600" />
        <h3 className="font-semibold text-sm">Step 1 — Rack Scanner</h3>
      </div>
      <div className="flex gap-2">
        <input
          ref={input.ref}
          value={input.value}
          onChange={(e) => input.setValue(e.target.value)}
          onKeyDown={input.onKeyDown}
          disabled={!active || done}
          placeholder="Scan fixture barcode or QR at the rack"
          className={`flex-1 rounded-md bg-background border px-3 py-3 text-base outline-none ${borderCls} disabled:opacity-50`}
          maxLength={100}
          autoFocus
        />
        <button type="button" onClick={() => setCam(true)} disabled={!active || done}
          className="rounded-md bg-primary text-primary-foreground p-2.5 disabled:opacity-50" aria-label="Camera">
          <Camera className="h-5 w-5" />
        </button>
      </div>

      {result?.kind === "no-active" && (
        <div className="mt-3 rounded-md bg-amber-50 border border-amber-300 text-amber-900 text-sm p-3 flex gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5" /> No active request selected — please select a request first.
        </div>
      )}
      {result?.kind === "ok" && (
        <div className="mt-3 rounded-md bg-green-50 border-2 border-green-500 text-green-900 p-4">
          <div className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-5 w-5" /> CORRECT FIXTURE</div>
          <div className="font-mono text-xs mt-2">{result.fx.fixture_id}</div>
          <div className="font-semibold">{result.fx.name}</div>
          <div className="text-xs">Model: {result.fx.model_number || "—"}</div>
          <div className="text-xs mt-1">📍 {locationPathText(result.fx) ?? "—"}</div>
          <div className="mt-2 text-sm font-medium">Fixture verified. Walk to the gate and scan to open.</div>
        </div>
      )}
      {result?.kind === "wrong" && (
        <div className="mt-3 rounded-md bg-red-50 border-2 border-red-500 text-red-900 p-4">
          <div className="flex items-center gap-2 font-bold"><XCircle className="h-5 w-5" /> WRONG FIXTURE SCANNED</div>
          <div className="mt-2 text-sm grid grid-cols-[80px_1fr] gap-y-1">
            <div className="font-semibold">You scanned:</div>
            <div className="font-mono">{result.scanned} {result.scannedFx ? `— ${result.scannedFx.name}` : ""}</div>
            <div className="font-semibold">Expected:</div>
            <div className="font-mono">{result.expectedCode} — {result.expectedName}</div>
          </div>
          <div className="mt-2 text-sm">Please return this fixture and find the correct one. You can scan again immediately.</div>
        </div>
      )}

      {cam && <CameraScanModal onClose={() => setCam(false)} onResult={(t) => { setCam(false); handle(t.trim()); }} />}
    </div>
  );
}

// ====== Station 2 ======
function ScanStation2({ active, unlocked, onMatch, onWrong }: {
  active: ReqRow | null;
  unlocked: boolean;
  onMatch: (fxId: string) => void;
  onWrong: (scanned: string, expectedFxId: string) => void;
}) {
  type Result =
    | { kind: "ok"; fxCode: string }
    | { kind: "wrong"; scanned: string; expectedCode: string }
    | null;
  const [result, setResult] = useState<Result>(null);
  const [cam, setCam] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const expected = active?.request_items.find((i) => i.fixtures)?.fixtures ?? null;

  const handle = async (value: string) => {
    if (!active || !expected || !unlocked) return;
    const code = value.trim();
    if (code === expected.fixture_id) {
      setResult({ kind: "ok", fxCode: code });
      onMatch(expected.id);
      setCountdown(10);
    } else {
      setResult({ kind: "wrong", scanned: code, expectedCode: expected.fixture_id });
      onWrong(code, expected.id);
      input.clearAndRefocus();
    }
  };

  const input = useScanInput({ enabled: unlocked && result?.kind !== "ok", onSubmit: handle });

  useEffect(() => { setResult(null); setCountdown(null); }, [active?.id]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const borderCls = result?.kind === "ok" ? "border-green-500" : result?.kind === "wrong" ? "border-red-500" : "border-border";

  return (
    <div className="relative rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <DoorOpen className="h-4 w-4 text-blue-600" />
        <h3 className="font-semibold text-sm">Step 2 — Gate Scanner</h3>
      </div>

      <div className="flex gap-2">
        <input
          ref={input.ref}
          value={input.value}
          onChange={(e) => input.setValue(e.target.value)}
          onKeyDown={input.onKeyDown}
          disabled={!unlocked || result?.kind === "ok"}
          placeholder="Scan fixture barcode or QR at the gate"
          className={`flex-1 rounded-md bg-background border-2 px-3 py-4 text-lg outline-none ${borderCls} disabled:opacity-60`}
          maxLength={100}
        />
        <button type="button" onClick={() => setCam(true)} disabled={!unlocked || result?.kind === "ok"}
          className="rounded-md bg-primary text-primary-foreground p-2.5 disabled:opacity-50" aria-label="Camera">
          <Camera className="h-5 w-5" />
        </button>
      </div>

      {result?.kind === "ok" && (
        <div className="mt-3 rounded-md bg-green-50 border-2 border-green-500 text-green-900 p-4">
          <div className="flex items-center gap-2 font-bold text-lg"><CheckCircle2 className="h-6 w-6" /> GATE OPENING</div>
          <div className="mt-2 text-sm">
            <div><span className="font-mono">{result.fxCode}</span> confirmed</div>
            <div>Worker: {active?.worker?.full_name} ({active?.worker?.employee_id})</div>
          </div>
          {countdown !== null && countdown > 0 && (
            <div className="mt-2 text-sm font-medium">Gate closing in {countdown}…</div>
          )}
          {countdown === 0 && <div className="mt-2 text-sm font-medium">Gate closed — transaction complete.</div>}
        </div>
      )}
      {result?.kind === "wrong" && (
        <div className="mt-3 rounded-md bg-red-50 border-2 border-red-500 text-red-900 p-4">
          <div className="flex items-center gap-2 font-bold"><XCircle className="h-5 w-5" /> GATE LOCKED — WRONG FIXTURE</div>
          <div className="mt-2 text-sm grid grid-cols-[80px_1fr] gap-y-1">
            <div className="font-semibold">You scanned:</div><div className="font-mono">{result.scanned}</div>
            <div className="font-semibold">Expected:</div><div className="font-mono">{result.expectedCode}</div>
          </div>
          <div className="mt-2 text-sm">Gate will not open. Do not hand over fixture. Scan again at the gate.</div>
        </div>
      )}

      {!unlocked && (
        <div className="absolute inset-0 rounded-xl bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2">
          <Lock className="h-8 w-8 text-muted-foreground" />
          <div className="text-sm font-medium text-muted-foreground">Complete Step 1 first</div>
        </div>
      )}

      {cam && <CameraScanModal onClose={() => setCam(false)} onResult={(t) => { setCam(false); handle(t.trim()); }} />}
    </div>
  );
}
