import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Camera, Lock, MapPin, DoorOpen, X, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { sanitizeText } from "@/lib/sanitize";
import { toast } from "sonner";
import { FIXTURE_LOCATION_SELECT, locationPathText, type FixtureWithLocation } from "@/lib/fixtures";
import { FixtureLocationBadge } from "@/components/FixtureLocationBadge";
import { useI18n } from "@/lib/i18n";
import { playSuccessBeep, playGateOpenSound, playErrorSound, playLongSuccessSound } from "@/lib/gate-audio";
import { useAutoStopScanner } from "@/lib/scanner-camera";
import { DualScanInput } from "@/components/DualScanInput";
import { checkNFCSupport } from "@/hooks/useNFCScan";
import { homeLocationParts, homeLocationPathText } from "@/lib/fixtures";

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

type ScanStatus = "idle" | "scanning" | "success" | "error";
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function GatekeeperHome() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const [requests, setRequests] = useState<ReqRow[]>([]);
  const [active, setActive] = useState<ReqRow | null>(null);
  const [scan1Done, setScan1Done] = useState(false);
  const [showNfcBanner, setShowNfcBanner] = useState(false);

  useEffect(() => {
    const key = "nelson-gk-nfc-banner-dismissed";
    const support = checkNFCSupport();
    setShowNfcBanner(!support.supported && sessionStorage.getItem(key) !== "1");
  }, []);

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
    const now = new Date().toISOString();
    await supabase.from("requests").update({ status: "ready", ready_at: now, gate_status: "scan1_verified", verified_fixture_id: fxId }).eq("id", active.id);
    await supabase.from("gate_log").insert({
      command: "open",
      executed: false,
      worker_id: active.worker?.id ?? null,
      fixture_id: fxId,
      request_id: active.id,
      gatekeeper_id: profile.id,
      scan_1_verified: true,
      scan_1_at: now,
    });
    setScan1Done(true);
    playLongSuccessSound();
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
    <div className="space-y-4">
      {showNfcBanner && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold">NFC scanning unavailable on this device/browser.</div>
            <div className="text-xs mt-0.5">Camera scanning is fully functional.</div>
          </div>
          <button
            className="text-xs underline"
            onClick={() => {
              sessionStorage.setItem("nelson-gk-nfc-banner-dismissed", "1");
              setShowNfcBanner(false);
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="grid lg:grid-cols-2 gap-4 lg:gap-6">
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
    </div>
  );
}

function QueueCard({ req, isActive, onStart }: { req: ReqRow; isActive: boolean; onStart: () => void }) {
  const { t } = useI18n();
  const elapsed = Math.round((Date.now() - new Date(req.created_at).getTime()) / 60000);
  return (
    <div className={`rounded-xl border p-3 sm:p-4 ${isActive ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <div className="font-medium truncate">{req.worker?.full_name}</div>
          <div className="text-xs text-muted-foreground">{req.worker?.employee_id} · {req.worker?.department ?? "—"}</div>
        </div>
        <span className="shrink-0 text-[10px] uppercase font-semibold px-2 py-1 rounded bg-secondary text-secondary-foreground">{req.status}</span>
      </div>
      <ul className="mt-3 space-y-1">
        {req.request_items.map((i) => i.fixtures && (
          <li key={i.id} className="text-xs">
            <span className="font-mono text-muted-foreground">{i.fixtures.fixture_id}</span>
            <span className="ml-2">{i.fixtures.name}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="text-xs text-muted-foreground">{elapsed}m ago</div>
        <button onClick={onStart} className={`text-xs font-medium px-3 py-2 sm:py-1.5 rounded ${isActive ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"}`}>
          {isActive ? "Active" : t("gk.start_preparing")}
        </button>
      </div>
    </div>
  );
}

function ActiveRequestCard({ req, scan1Done, onCancel }: { req: ReqRow | null; scan1Done: boolean; onCancel: () => void }) {
  if (!req) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4 sm:p-6 text-center text-sm text-muted-foreground">
        Select a request from the queue to begin
      </div>
    );
  }
  const elapsed = Math.round((Date.now() - new Date(req.created_at).getTime()) / 60000);
  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
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
          <span className={scan1Done ? "text-muted-foreground line-through" : "font-medium"}>Step 1: Verify rack, row, and fixture</span>
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
  const { ref } = useAutoStopScanner(onResult);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      <button onClick={onClose} className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 text-white" aria-label="Close">
        <X className="h-5 w-5" />
      </button>
      <div className="scanner-camera-stage">
        <video ref={ref} autoPlay playsInline muted />
        <div className="scanner-viewfinder" aria-hidden="true" />
      </div>
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
  type StepKey = "rack" | "row" | "fixture";
  type StepState = { status: ScanStatus; message: string };
  const [step, setStep] = useState<StepKey>("rack");
  const [states, setStates] = useState<Record<StepKey, StepState>>({
    rack: { status: "idle", message: "" },
    row: { status: "idle", message: "" },
    fixture: { status: "idle", message: "" },
  });
  const expected = active?.request_items.find((i) => i.fixtures)?.fixtures ?? null;
  const home = homeLocationParts(expected);

  const setStepState = (key: StepKey, status: ScanStatus, message: string) => {
    setStates((old) => ({ ...old, [key]: { status, message } }));
  };

  const clearErrorLater = (key: StepKey) => {
    setTimeout(() => setStates((old) => old[key].status === "error" ? { ...old, [key]: { status: "idle", message: "" } } : old), 2000);
  };

  const findRack = async (value: string) => {
    if (uuidRe.test(value)) {
      const { data } = await supabase.from("racks").select("*,zones(name)").eq("id", value).maybeSingle();
      if (data) return data as { id: string; name: string; nfc_tag_id: string | null; zones?: { name: string } | null };
    }
    const { data } = await supabase.from("racks").select("*,zones(name)").eq("nfc_tag_id", value).maybeSingle();
    return data as { id: string; name: string; nfc_tag_id: string | null; zones?: { name: string } | null } | null;
  };

  const findRow = async (value: string) => {
    if (uuidRe.test(value)) {
      const { data } = await supabase.from("rows").select("*,racks(name,id)").eq("id", value).maybeSingle();
      if (data) return data as { id: string; rack_id: string; name: string; nfc_tag_id: string | null; racks?: { id: string; name: string } | null };
    }
    const { data } = await supabase.from("rows").select("*,racks(name,id)").eq("nfc_tag_id", value).maybeSingle();
    return data as { id: string; rack_id: string; name: string; nfc_tag_id: string | null; racks?: { id: string; name: string } | null } | null;
  };

  const findFixture = async (value: string) => {
    const byCode = await supabase.from("fixtures").select(FIXTURE_LOCATION_SELECT).eq("fixture_id", value).maybeSingle();
    if (byCode.data) return byCode.data as unknown as FixtureWithLocation;
    const byNfc = await supabase.from("fixtures").select(FIXTURE_LOCATION_SELECT).eq("nfc_tag_id", value).maybeSingle();
    return (byNfc.data as unknown as FixtureWithLocation | null) ?? null;
  };

  const handleRack = async (value: string) => {
    if (!active || !expected || !home || done) return;
    const rack = await findRack(value);
    if (rack && rack.id === expected.home_slot?.row?.rack?.id) {
      await supabase.from("requests").update({ scan1_rack_verified: true, scan1_rack_at: new Date().toISOString() }).eq("id", active.id);
      setStepState("rack", "success", `Rack confirmed - ${rack.name}`);
      setStep("row");
      playSuccessBeep();
      return;
    }
    const msg = rack ? `Wrong rack - Expected ${home.rack} - You scanned ${rack.name}` : "Label not recognized as a rack - please try again";
    setStepState("rack", "error", msg);
    playErrorSound();
    clearErrorLater("rack");
  };

  const handleRow = async (value: string) => {
    if (!active || !expected || !home || done) return;
    const row = await findRow(value);
    if (row && row.id === expected.home_slot?.row?.id) {
      await supabase.from("requests").update({ scan1_row_verified: true, scan1_row_at: new Date().toISOString() }).eq("id", active.id);
      setStepState("row", "success", `Row confirmed - ${row.name}`);
      setStep("fixture");
      playSuccessBeep();
      return;
    }
    const msg = row ? `Wrong row - Expected ${home.row} - You scanned ${row.name}` : "Label not recognized as a row";
    setStepState("row", "error", msg);
    playErrorSound();
    clearErrorLater("row");
  };

  const handleFixture = async (value: string) => {
    if (!active || !expected || done) return;
    const fx = await findFixture(value);
    if (fx && fx.id === expected.id) {
      await supabase.from("requests").update({ scan1_fixture_verified: true, scan1_fixture_at: new Date().toISOString() }).eq("id", active.id);
      setStepState("fixture", "success", `Fixture confirmed - ${fx.fixture_id} - ${fx.name}`);
      playLongSuccessSound();
      return;
    }
    const msg = fx ? `Wrong fixture - Expected ${expected.name} - You scanned ${fx.name}` : "Label not recognized as a fixture";
    setStepState("fixture", "error", msg);
    onWrong(value, expected.id);
    clearErrorLater("fixture");
  };

  useEffect(() => {
    setStep("rack");
    setStates({
      rack: { status: "idle", message: "" },
      row: { status: "idle", message: "" },
      fixture: { status: "idle", message: "" },
    });
  }, [active?.id]);

  const readyToMark = states.fixture.status === "success" && expected && !done;

  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4 space-y-3">
      <div className="flex items-center gap-2 mb-3">
        <MapPin className="h-4 w-4 text-amber-600" />
        <h3 className="font-semibold text-sm">STATION 1 - Fixture Verification</h3>
      </div>

      {!active && (
        <div className="rounded-md bg-amber-50 border border-amber-300 text-amber-900 text-sm p-3 flex gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5" /> No active request selected - please select a request first.
        </div>
      )}

      {active && !home && (
        <div className="rounded-md bg-red-50 border border-red-300 text-red-900 text-sm p-3">
          This fixture has no home rack/row assigned. Assign a home slot before preparing it.
        </div>
      )}

      <ScanStepCard
        title="Step 1 of 3 - Scan Rack"
        doneText={states.rack.status === "success" ? states.rack.message : ""}
        active={!!active && !!home && step === "rack" && !done}
        locked={false}
        indicator={states.rack.status === "success" ? "✓" : "●"}
      >
        <div className="text-xs text-muted-foreground mb-2">
          Go to {home?.zone ?? "Zone"} - {home?.rack ?? "Rack"} and scan the rack label or tap its NFC tag
        </div>
        <DualScanInput
          label="Rack Scan"
          instruction="Scan rack QR code, barcode, or tap NFC tag on the rack"
          active={!!active && !!home && step === "rack" && !done}
          onScanResult={handleRack}
          status={states.rack.status}
          successMessage={states.rack.message}
          errorMessage={states.rack.message}
        />
      </ScanStepCard>

      <ScanStepCard
        title="Step 2 of 3 - Scan Row"
        doneText={states.row.status === "success" ? states.row.message : ""}
        active={!!active && step === "row" && !done}
        locked={states.rack.status !== "success"}
        indicator={states.row.status === "success" ? "✓" : step === "row" ? "●" : "○"}
      >
        <div className="text-xs text-muted-foreground mb-2">
          Now scan the row label or tap its NFC tag on {home?.row ?? "the expected row"}
        </div>
        <DualScanInput
          label="Row Scan"
          instruction="Scan row QR code, barcode, or tap NFC tag on the row"
          active={!!active && step === "row" && !done}
          onScanResult={handleRow}
          status={states.row.status}
          successMessage={states.row.message}
          errorMessage={states.row.message}
          disabled={states.rack.status !== "success"}
        />
      </ScanStepCard>

      <ScanStepCard
        title="Step 3 of 3 - Scan Fixture"
        doneText={states.fixture.status === "success" ? states.fixture.message : ""}
        active={!!active && step === "fixture" && !done}
        locked={states.row.status !== "success"}
        indicator={states.fixture.status === "success" ? "✓" : step === "fixture" ? "●" : "○"}
      >
        <div className="text-xs text-muted-foreground mb-2">Now scan the fixture label or tap its NFC tag</div>
        <DualScanInput
          label="Fixture Scan"
          instruction="Scan fixture QR code, barcode, or tap NFC tag on the fixture"
          active={!!active && step === "fixture" && !done}
          onScanResult={handleFixture}
          status={states.fixture.status}
          successMessage={states.fixture.message}
          errorMessage={states.fixture.message}
          disabled={states.row.status !== "success"}
        />
        {states.fixture.status === "success" && expected && (
          <div className="mt-3 rounded-md bg-green-50 border-2 border-green-500 text-green-900 p-4">
            <div className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-5 w-5" /> CORRECT FIXTURE CONFIRMED</div>
            <div className="font-mono text-xs mt-2">{expected.fixture_id}</div>
            <div className="font-semibold">{expected.name}</div>
            <div className="text-xs">Model: {expected.model_number || "—"}</div>
            <div className="text-xs mt-1">{homeLocationPathText(expected) ?? locationPathText(expected) ?? "Location not assigned"}</div>
            {readyToMark && (
              <button onClick={() => onMatch(expected.id)} className="mt-3 w-full rounded-md bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600">
                Mark Ready
              </button>
            )}
          </div>
        )}
      </ScanStepCard>

      {done && (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          Station 1 complete - worker can proceed to the gate.
        </div>
      )}
    </div>
  );
}

function ScanStepCard({
  title,
  indicator,
  doneText,
  active,
  locked,
  children,
}: {
  title: string;
  indicator: string;
  doneText: string;
  active: boolean;
  locked: boolean;
  children: React.ReactNode;
}) {
  if (doneText && !active) {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
        <span className="font-bold mr-2">✓</span>{doneText}
      </div>
    );
  }
  if (locked) {
    return (
      <div className="rounded-lg border border-border bg-secondary/30 px-3 py-3 text-sm text-muted-foreground">
        <span className="font-bold mr-2">○</span>{title} <span className="text-xs">[locked]</span>
      </div>
    );
  }
  return (
    <div className={`rounded-lg border px-3 py-3 ${active ? "border-primary bg-primary/5" : "border-border bg-background"}`}>
      <div className="font-semibold text-sm mb-2"><span className="mr-2">{indicator}</span>{title}</div>
      {children}
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
    <div className="relative rounded-xl border border-border bg-card p-3 sm:p-4">
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
          className={`min-w-0 flex-1 rounded-md bg-background border-2 px-3 py-3 sm:py-4 text-base sm:text-lg outline-none ${borderCls} disabled:opacity-60`}
          maxLength={100}
        />
        <button type="button" onClick={() => setCam(true)} disabled={!unlocked || result?.kind === "ok"}
          className="shrink-0 rounded-md bg-primary text-primary-foreground p-2.5 disabled:opacity-50" aria-label="Camera">
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
          <div className="mt-2 text-sm grid grid-cols-1 sm:grid-cols-[80px_1fr] gap-y-1">
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
