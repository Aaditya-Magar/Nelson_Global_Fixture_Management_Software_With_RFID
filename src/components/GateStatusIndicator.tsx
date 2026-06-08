import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type GateState = "closed" | "opening" | "open" | "failed";

type GateLogRow = {
  id: string;
  executed: boolean;
  gate_opened: boolean;
  gate_opened_at: string | null;
  scan_2_verified: boolean;
  failure_reason: string | null;
  created_at: string;
};

export function useGateStatus(): { state: GateState; label: string } {
  const [state, setState] = useState<GateState>("closed");

  useEffect(() => {
    let active = true;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;

    const compute = (row: GateLogRow | null) => {
      if (!row) return setState("closed");
      if (row.failure_reason && !row.gate_opened) {
        setState("failed");
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => active && setState("closed"), 6000);
        return;
      }
      if (row.gate_opened || row.executed) {
        setState("open");
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => active && setState("closed"), 10000);
        return;
      }
      if (row.scan_2_verified) {
        setState("opening");
        return;
      }
      setState("closed");
    };

    const load = async () => {
      const { data } = await supabase
        .from("gate_log")
        .select("id,executed,gate_opened,gate_opened_at,scan_2_verified,failure_reason,created_at")
        .order("created_at", { ascending: false })
        .limit(1);
      if (!active) return;
      compute(((data ?? [])[0] as GateLogRow) ?? null);
    };
    load();

    const ch = supabase.channel("gate-status")
      .on("postgres_changes", { event: "*", schema: "public", table: "gate_log" }, load)
      .subscribe();

    return () => {
      active = false;
      if (resetTimer) clearTimeout(resetTimer);
      supabase.removeChannel(ch);
    };
  }, []);

  const label =
    state === "open" ? "Gate Open" :
    state === "opening" ? "Gate Opening…" :
    state === "failed" ? "Gate Locked — Wrong Fixture" :
    "Gate Closed";
  return { state, label };
}

export function GateStatusIndicator({ className = "" }: { className?: string }) {
  const { state, label } = useGateStatus();
  const color =
    state === "open" ? "bg-green-500" :
    state === "opening" ? "bg-amber-500 animate-pulse" :
    state === "failed" ? "bg-red-500" :
    "bg-gray-400";
  return (
    <div className={`inline-flex items-center gap-2 text-xs rounded-full px-3 py-1 bg-white/10 ${className}`}>
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span>{label}</span>
    </div>
  );
}
