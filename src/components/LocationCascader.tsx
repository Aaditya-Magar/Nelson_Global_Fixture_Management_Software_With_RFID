import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Zone = { id: string; name: string };
type Rack = { id: string; zone_id: string; name: string };
type Row  = { id: string; rack_id: string; name: string };
type Slot = { id: string; row_id: string; name: string; is_occupied: boolean };

type Props = {
  /** Currently selected slot id (controlled). */
  value: string | null;
  onChange: (slotId: string | null) => void;
  /** A slot id to always include in the slot dropdown even if occupied (current selection when editing). */
  includeSlotId?: string | null;
  layout?: "grid" | "stack";
};

export function LocationCascader({ value, onChange, includeSlotId, layout = "grid" }: Props) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [rows, setRows]   = useState<Row[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);

  const [zoneId, setZoneId] = useState("");
  const [rackId, setRackId] = useState("");
  const [rowId, setRowId]   = useState("");

  // initial load of zones
  useEffect(() => {
    supabase.from("zones").select("id,name").order("name").then(({ data }) => setZones((data as Zone[]) ?? []));
  }, []);

  // If we have a value (slot id) on mount or change, derive parent ids
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      if (!value) return;
      const { data } = await supabase
        .from("slots")
        .select("id,row_id,name,is_occupied,rows(id,rack_id,name,racks(id,zone_id,name,zones(id,name)))")
        .eq("id", value)
        .maybeSingle();
      if (cancelled || !data) return;
      const d = data as unknown as Slot & { rows: { id: string; rack_id: string; name: string; racks: { id: string; zone_id: string; name: string; zones: { id: string; name: string } } } | null };
      if (d.rows) {
        setZoneId(d.rows.racks.zone_id);
        setRackId(d.rows.racks.id);
        setRowId(d.rows.id);
      }
    };
    hydrate();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cascading loads
  useEffect(() => {
    if (!zoneId) { setRacks([]); return; }
    supabase.from("racks").select("id,zone_id,name").eq("zone_id", zoneId).order("name")
      .then(({ data }) => setRacks((data as Rack[]) ?? []));
  }, [zoneId]);

  useEffect(() => {
    if (!rackId) { setRows([]); return; }
    supabase.from("rows").select("id,rack_id,name").eq("rack_id", rackId).order("name")
      .then(({ data }) => setRows((data as Row[]) ?? []));
  }, [rackId]);

  useEffect(() => {
    if (!rowId) { setSlots([]); return; }
    supabase.from("slots").select("id,row_id,name,is_occupied").eq("row_id", rowId).order("name")
      .then(({ data }) => setSlots((data as Slot[]) ?? []));
  }, [rowId]);

  const slotOptions = slots.filter((s) => !s.is_occupied || s.id === includeSlotId || s.id === value);

  const sel = "w-full rounded border border-border px-3 py-2 bg-background text-sm";
  const wrap = layout === "grid" ? "grid grid-cols-2 gap-3" : "space-y-3";

  return (
    <div className={wrap}>
      <Labeled label="Zone">
        <select className={sel} value={zoneId} onChange={(e) => { setZoneId(e.target.value); setRackId(""); setRowId(""); onChange(null); }}>
          <option value="">Select zone…</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
      </Labeled>
      <Labeled label="Rack">
        <select className={sel} disabled={!zoneId} value={rackId} onChange={(e) => { setRackId(e.target.value); setRowId(""); onChange(null); }}>
          <option value="">Select rack…</option>
          {racks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Labeled>
      <Labeled label="Row">
        <select className={sel} disabled={!rackId} value={rowId} onChange={(e) => { setRowId(e.target.value); onChange(null); }}>
          <option value="">Select row…</option>
          {rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Labeled>
      <Labeled label="Slot">
        <select className={sel} disabled={!rowId} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Select slot…</option>
          {slotOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}{s.is_occupied && s.id !== value ? " (occupied)" : ""}
            </option>
          ))}
        </select>
      </Labeled>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-xs text-muted-foreground mb-1">{label}</span>{children}</label>;
}
