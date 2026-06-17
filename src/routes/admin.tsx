import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import bwipjs from "bwip-js/browser";
import { LogOut, Package, MapPin, Layers, Users, ShieldCheck, BarChart3, Plus, Printer, Search, ChevronRight, ChevronLeft, Pencil, Download, Trash2, Eye, EyeOff, DoorOpen, Radio } from "lucide-react";
import { GateActivity } from "@/components/GateActivity";
import { RequireRole } from "@/components/RequireRole";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "@tanstack/react-router";
import { sanitizeText } from "@/lib/sanitize";
import { toast } from "sonner";
import { createAccount, setAccountActive } from "@/lib/admin-accounts.functions";
import { LocationCascader } from "@/components/LocationCascader";
import { FixtureLocationBadge } from "@/components/FixtureLocationBadge";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";
import {
  FIXTURE_LOCATION_SELECT,
  locationPathText,
  locationParts,
  type FixtureWithLocation,
} from "@/lib/fixtures";
import { useNFCScan } from "@/hooks/useNFCScan";

export const Route = createFileRoute("/admin")({
  component: () => (
    <RequireRole role="admin" loginPath="/secure/admin-panel">
      <AdminApp />
    </RequireRole>
  ),
});

type Tab = "dashboard" | "locations" | "types" | "fixtures" | "workers" | "gatekeepers" | "gate";

function AdminApp() {
  const { profile, signOut } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("dashboard");

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "dashboard", label: t("nav.dashboard"), icon: BarChart3 },
    { id: "locations", label: t("nav.locations"), icon: MapPin },
    { id: "types", label: t("nav.types"), icon: Layers },
    { id: "fixtures", label: t("nav.fixtures"), icon: Package },
    { id: "workers", label: t("nav.workers"), icon: Users },
    { id: "gatekeepers", label: t("nav.gatekeepers"), icon: ShieldCheck },
    { id: "gate", label: "Gate Activity", icon: DoorOpen },
  ];

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-background overflow-x-hidden">
      <aside className="lg:w-60 bg-card lg:bg-sidebar text-foreground lg:text-sidebar-foreground border-b border-border lg:border-b-0 flex lg:flex-col overflow-hidden">
        <div className="shrink-0 px-4 py-3 lg:py-5">
          <div className="text-xs uppercase tracking-wider opacity-70">{t("admin.title")}</div>
          <div className="font-semibold text-sm mt-0.5">{profile?.full_name}</div>
        </div>
        <nav className="flex flex-1 lg:block lg:space-y-1 px-2 py-2 lg:py-0 overflow-x-auto scrollbar-hidden lg:overflow-visible">
          {tabs.map((tt) => {
            const Icon = tt.icon;
            const active = tab === tt.id;
            return (
              <button
                key={tt.id}
                onClick={() => setTab(tt.id)}
                className={`shrink-0 lg:w-full text-left flex items-center gap-2 lg:gap-3 px-3 py-2 rounded-md text-sm whitespace-nowrap ${active ? "bg-primary text-primary-foreground lg:bg-sidebar-primary lg:text-sidebar-primary-foreground" : "hover:bg-secondary lg:hover:bg-sidebar-accent"}`}
              >
                <Icon className="h-4 w-4" />
                {tt.label}
              </button>
            );
          })}
        </nav>
        <div className="m-3 hidden lg:block space-y-2">
          <LanguageSwitcher className="w-full" />
          <button
            onClick={async () => { await signOut(); nav({ to: "/secure/admin-panel" }); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded hover:bg-sidebar-accent"
          >
            <LogOut className="h-4 w-4" /> {t("nav.signout")}
          </button>
        </div>
      </aside>
      <main className="flex-1 w-full max-w-full p-4 sm:p-6 overflow-x-hidden lg:overflow-auto min-w-0">
        {tab === "dashboard" && <Dashboard />}
        {tab === "locations" && <Locations />}
        {tab === "types" && <FixtureTypes />}
        {tab === "fixtures" && <Fixtures />}
        {tab === "workers" && <Accounts role="worker" />}
        {tab === "gatekeepers" && <Accounts role="gatekeeper" />}
        {tab === "gate" && <GateActivity />}
      </main>
    </div>
  );
}

// ============= DASHBOARD =============
function Dashboard() {
  const { t } = useI18n();
  const [stats, setStats] = useState({ total: 0, available: 0, checkedOut: 0, maintenance: 0, pending: 0 });
  type RecentRow = { id: string; checked_out_at: string; returned_at: string | null; status: string; fixtures: { name: string; fixture_id: string; model_number: string | null } | null; worker: { full_name: string } | null; gatekeeper: { full_name: string } | null };
  const [recent, setRecent] = useState<RecentRow[]>([]);
  useEffect(() => {
    const load = async () => {
      const [tot, av, co, mn, pn, rc] = await Promise.all([
        supabase.from("fixtures").select("id", { count: "exact", head: true }),
        supabase.from("fixtures").select("id", { count: "exact", head: true }).eq("status", "available"),
        supabase.from("fixtures").select("id", { count: "exact", head: true }).eq("status", "checked_out"),
        supabase.from("fixtures").select("id", { count: "exact", head: true }).eq("status", "maintenance"),
        supabase.from("requests").select("id", { count: "exact", head: true }).in("status", ["pending", "preparing", "ready"]),
        supabase.from("transactions").select("id,checked_out_at,returned_at,status,fixtures(name,fixture_id,model_number),worker:profiles!transactions_worker_id_fkey(full_name),gatekeeper:profiles!transactions_gatekeeper_id_fkey(full_name)").order("checked_out_at", { ascending: false }).limit(15),
      ]);
      setStats({ total: tot.count ?? 0, available: av.count ?? 0, checkedOut: co.count ?? 0, maintenance: mn.count ?? 0, pending: pn.count ?? 0 });
      setRecent((rc.data as unknown as RecentRow[]) ?? []);
    };
    load();
  }, []);
  const fmt = (s: string | null) => s ? new Date(s).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—";
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("admin.dashboard")}</h1>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label={t("admin.total_fixtures")} value={stats.total} />
        <Stat label={t("admin.available")} value={stats.available} color="text-green-600" />
        <Stat label={t("admin.checked_out")} value={stats.checkedOut} color="text-red-600" />
        <Stat label={t("admin.maintenance")} value={stats.maintenance} color="text-amber-600" />
        <Stat label={t("admin.active_requests")} value={stats.pending} color="text-blue-600" />
      </div>
      <div>
        <h2 className="font-semibold mb-2">{t("admin.recent_transactions")}</h2>
        <div className="hidden md:block rounded-xl border border-border bg-card overflow-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-secondary"><tr>
              <th className="text-left p-2">{t("admin.fixture")}</th>
              <th className="text-left p-2">{t("admin.model")}</th>
              <th className="text-left p-2">{t("admin.worker")}</th>
              <th className="text-left p-2">{t("admin.gatekeeper")}</th>
              <th className="text-left p-2">{t("gk.checked_out_at")}</th>
              <th className="text-left p-2">{t("gk.returned_at")}</th>
              <th className="text-left p-2">{t("admin.status")}</th>
            </tr></thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-2">{r.fixtures?.name} <span className="font-mono text-xs text-muted-foreground">{r.fixtures?.fixture_id}</span></td>
                  <td className="p-2">{r.fixtures?.model_number || <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-2">{r.worker?.full_name ?? "—"}</td>
                  <td className="p-2">{r.gatekeeper?.full_name ?? "—"}</td>
                  <td className="p-2 whitespace-nowrap">{fmt(r.checked_out_at)}</td>
                  <td className="p-2 whitespace-nowrap">{fmt(r.returned_at)}</td>
                  <td className="p-2"><span className={`text-[10px] uppercase font-semibold px-2 py-1 rounded ${r.status === "returned" ? "bg-gray-200 text-gray-700" : "bg-red-100 text-red-800"}`}>{r.status}</span></td>
                </tr>
              ))}
              {recent.length === 0 && <tr><td className="p-3 text-center text-muted-foreground" colSpan={7}>{t("admin.no_transactions")}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="md:hidden space-y-2">
          {recent.map((r) => (
            <MobileCard key={r.id} title={r.fixtures?.name ?? "Fixture"} subtitle={r.fixtures?.fixture_id}>
              <MobileField label={t("admin.model")}>{r.fixtures?.model_number || "—"}</MobileField>
              <MobileField label={t("admin.worker")}>{r.worker?.full_name ?? "—"}</MobileField>
              <MobileField label={t("admin.gatekeeper")}>{r.gatekeeper?.full_name ?? "—"}</MobileField>
              <MobileField label={t("gk.checked_out_at")}>{fmt(r.checked_out_at)}</MobileField>
              <MobileField label={t("gk.returned_at")}>{fmt(r.returned_at)}</MobileField>
              <MobileField label={t("admin.status")}><span className={`text-[10px] uppercase font-semibold px-2 py-1 rounded ${r.status === "returned" ? "bg-gray-200 text-gray-700" : "bg-red-100 text-red-800"}`}>{r.status}</span></MobileField>
            </MobileCard>
          ))}
          {recent.length === 0 && <EmptyMobileCard>{t("admin.no_transactions")}</EmptyMobileCard>}
        </div>
      </div>

      <AllFixturesAndLocations />
    </div>
  );
}

function Stat({ label, value, color = "" }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function AllFixturesAndLocations() {
  const [list, setList] = useState<FixtureWithLocation[]>([]);
  const [q, setQ] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [zones, setZones] = useState<{ id: string; name: string }[]>([]);
  const [types, setTypes] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    supabase.from("fixtures").select(FIXTURE_LOCATION_SELECT).order("fixture_id").then(({ data }) => {
      setList((data as unknown as FixtureWithLocation[]) ?? []);
    });
    supabase.from("zones").select("id,name").order("name").then(({ data }) => setZones((data as { id: string; name: string }[]) ?? []));
    supabase.from("fixture_types").select("id,name").order("name").then(({ data }) => setTypes((data as { id: string; name: string }[]) ?? []));
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return list.filter((f) => {
      if (term) {
        const hay = `${f.fixture_id} ${f.name} ${f.model_number ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (typeFilter && f.fixture_type_id !== typeFilter) return false;
      if (statusFilter && f.status !== statusFilter) return false;
      if (zoneFilter && f.current_slot?.row?.rack?.zone?.id !== zoneFilter) return false;
      return true;
    });
  }, [list, q, zoneFilter, typeFilter, statusFilter]);

  const exportCsv = () => {
    const header = ["Fixture ID", "Name", "Model Number", "Type", "Zone", "Rack", "Row", "Slot", "Status"];
    const rows = filtered.map((f) => {
      const p = locationParts(f);
      return [f.fixture_id, f.name, f.model_number ?? "", f.fixture_types?.name ?? "", p?.zone ?? "", p?.rack ?? "", p?.row ?? "", p?.slot ?? "", f.status];
    });
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fixtures-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center mb-3">
        <h2 className="font-semibold">All Fixtures and Locations</h2>
        <button onClick={exportCsv} className="w-full sm:w-auto justify-center text-xs px-3 py-2 rounded border border-border flex items-center gap-1"><Download className="h-3.5 w-3.5" /> Export CSV</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ID, name, model…" className="rounded border border-border px-3 py-2 bg-background text-sm" />
        <select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)} className="rounded border border-border px-3 py-2 bg-background text-sm">
          <option value="">All zones</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded border border-border px-3 py-2 bg-background text-sm">
          <option value="">All types</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded border border-border px-3 py-2 bg-background text-sm">
          <option value="">All statuses</option>
          <option value="available">Available</option>
          <option value="checked_out">Checked out</option>
          <option value="maintenance">Maintenance</option>
        </select>
      </div>
      <div className="hidden md:block rounded-xl border border-border bg-card overflow-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-secondary">
            <tr>
              <th className="text-left p-2">Fixture ID</th>
              <th className="text-left p-2">Name</th>
              <th className="text-left p-2">Model</th>
              <th className="text-left p-2">Type</th>
              <th className="text-left p-2">Zone</th>
              <th className="text-left p-2">Rack</th>
              <th className="text-left p-2">Row</th>
              <th className="text-left p-2">Slot</th>
              <th className="text-left p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => {
              const p = locationParts(f);
              return (
                <tr key={f.id} className="border-t border-border">
                  <td className="p-2 font-mono text-xs">{f.fixture_id}</td>
                  <td className="p-2">{f.name}</td>
                  <td className="p-2">{f.model_number || <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-2">{f.fixture_types?.name ?? "—"}</td>
                  <td className="p-2">{p?.zone ?? <span className="text-red-600 text-xs">—</span>}</td>
                  <td className="p-2">{p?.rack ?? "—"}</td>
                  <td className="p-2">{p?.row ?? "—"}</td>
                  <td className="p-2">{p?.slot ?? "—"}</td>
                  <td className="p-2"><StatusBadge status={f.status} /></td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={9} className="p-3 text-center text-muted-foreground">No fixtures.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="md:hidden space-y-2">
        {filtered.map((f) => {
          const p = locationParts(f);
          return (
            <MobileCard key={f.id} title={f.name} subtitle={f.fixture_id}>
              <MobileField label="Model">{f.model_number || "—"}</MobileField>
              <MobileField label="Type">{f.fixture_types?.name ?? "—"}</MobileField>
              <MobileField label="Location">{p ? `${p.zone} -> ${p.rack} -> ${p.row} -> ${p.slot}` : <span className="text-red-600">Not assigned</span>}</MobileField>
              <MobileField label="Status"><StatusBadge status={f.status} /></MobileField>
            </MobileCard>
          );
        })}
        {filtered.length === 0 && <EmptyMobileCard>No fixtures.</EmptyMobileCard>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    available: "bg-green-100 text-green-800",
    checked_out: "bg-red-100 text-red-800",
    maintenance: "bg-amber-100 text-amber-800",
  };
  return <span className={`text-[10px] uppercase font-semibold px-2 py-1 rounded ${map[status] ?? "bg-secondary"}`}>{status.replace("_", " ")}</span>;
}

function MobileCard({ title, subtitle, children }: { title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="min-w-0">
        <div className="font-medium leading-snug break-words">{title}</div>
        {subtitle && <div className="mt-0.5 font-mono text-xs text-muted-foreground break-words">{subtitle}</div>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">{children}</div>
    </div>
  );
}

function MobileField({ label, children, full = false }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "col-span-2 min-w-0" : "min-w-0"}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words">{children}</div>
    </div>
  );
}

function EmptyMobileCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">{children}</div>;
}

// ============= LOCATIONS =============
type Zone = { id: string; name: string };
type Rack = { id: string; zone_id: string; name: string; nfc_tag_id: string | null };
type Row  = { id: string; rack_id: string; name: string; nfc_tag_id: string | null };
type Slot = { id: string; row_id: string; name: string; is_occupied: boolean };

function Locations() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotFx, setSlotFx] = useState<Map<string, { id: string; fixture_id: string; name: string; model_number: string | null }>>(new Map());
  const [openZones, setOpenZones] = useState<Set<string>>(new Set());
  const [openRacks, setOpenRacks] = useState<Set<string>>(new Set());
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());

  const reload = async () => {
    const [z, r, ro, sl, fx] = await Promise.all([
      supabase.from("zones").select("*").order("name"),
      supabase.from("racks").select("*").order("name"),
      supabase.from("rows").select("*").order("name"),
      supabase.from("slots").select("*").order("name"),
      supabase.from("fixtures").select("id,fixture_id,name,model_number,current_slot_id").not("current_slot_id", "is", null),
    ]);
    setZones((z.data as Zone[]) ?? []);
    setRacks((r.data as Rack[]) ?? []);
    setRows((ro.data as Row[]) ?? []);
    setSlots((sl.data as Slot[]) ?? []);
    const m = new Map<string, { id: string; fixture_id: string; name: string; model_number: string | null }>();
    (fx.data as { id: string; fixture_id: string; name: string; model_number: string | null; current_slot_id: string }[] | null)?.forEach((f) => m.set(f.current_slot_id, f));
    setSlotFx(m);
    // auto-open first zone on initial load
    if ((z.data?.length ?? 0) > 0 && openZones.size === 0) setOpenZones(new Set([(z.data as Zone[])[0].id]));
  };
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  const addZone = async () => { const name = prompt("Zone name? (e.g. Main Storage, Zone A, North Wing)"); if (!name) return; const { error } = await supabase.from("zones").insert({ name: sanitizeText(name, 100) }); if (error) toast.error(error.message); else reload(); };
  const addRack = async (zone_id: string) => { const name = prompt("Rack name? (e.g. Rack-01, Rack-02)"); if (!name) return; const { error } = await supabase.from("racks").insert({ zone_id, name: sanitizeText(name, 100) }); if (error) toast.error(error.message); else reload(); };
  const addRow  = async (rack_id: string) => { const name = prompt("Row name? (e.g. Row 1 — Top)"); if (!name) return; const { error } = await supabase.from("rows").insert({ rack_id, name: sanitizeText(name, 100) }); if (error) toast.error(error.message); else reload(); };
  const addSlot = async (row_id: string)  => { const name = prompt("Slot name? (e.g. Slot-01, Slot-02)"); if (!name) return; const { error } = await supabase.from("slots").insert({ row_id, name: sanitizeText(name, 100) }); if (error) toast.error(error.message); else reload(); };

  const renameOrDelete = async (table: "zones" | "racks" | "rows" | "slots", row: { id: string; name: string }, mode: "rename" | "delete") => {
    if (mode === "delete") {
      if (!confirm(`Delete "${row.name}"? Any children will also be removed.`)) return;
      const { error } = await supabase.from(table).delete().eq("id", row.id);
      if (error) toast.error(error.message); else reload();
      return;
    }
    const v = prompt("New name?", row.name)?.trim();
    if (!v || v === row.name) return;
    const { error } = await supabase.from(table).update({ name: sanitizeText(v, 100) }).eq("id", row.id);
    if (error) toast.error(error.message); else reload();
  };

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-end mb-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Admin panel</div>
          <h1 className="text-3xl font-semibold">Locations</h1>
        </div>
        <button onClick={addZone} className="w-full sm:w-auto justify-center bg-primary text-primary-foreground px-3.5 py-2 rounded-md text-sm flex items-center gap-1.5 font-medium shadow-sm hover:opacity-90">
          <Plus className="h-4 w-4" /> Add zone
        </button>
      </div>

      <div className="rounded-lg bg-secondary/40 border border-border px-4 py-3 text-xs text-muted-foreground mb-4 leading-relaxed">
        Set up your physical storage room here. Each slot is one space for one fixture. Create zones → racks → rows → slots in order.
      </div>

      <div className="space-y-3">
        {zones.map((z) => {
          const zRacks = racks.filter((r) => r.zone_id === z.id);
          const zOpen = openZones.has(z.id);
          return (
            <div key={z.id} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 py-3 hover:bg-secondary/30">
                <button onClick={() => toggle(openZones, setOpenZones, z.id)} className="flex items-center gap-2.5 text-left flex-1 min-w-0">
                  <span className="h-7 w-7 rounded bg-secondary flex items-center justify-center"><MapPin className="h-4 w-4 text-muted-foreground" /></span>
                  <span className="font-medium truncate">{z.name}</span>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-primary/15 text-primary">{zRacks.length} {zRacks.length === 1 ? "rack" : "racks"}</span>
                </button>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  <button onClick={() => addRack(z.id)} className="text-xs px-2.5 py-1 rounded border border-dashed border-primary/40 text-primary hover:bg-primary/5 flex items-center gap-1"><Plus className="h-3 w-3" /> Add rack</button>
                  <IconBtn onClick={() => renameOrDelete("zones", z, "rename")} variant="edit" />
                  <IconBtn onClick={() => renameOrDelete("zones", z, "delete")} variant="delete" />
                  <button onClick={() => toggle(openZones, setOpenZones, z.id)} className="p-1.5 rounded hover:bg-secondary"><ChevronRight className={`h-4 w-4 transition-transform ${zOpen ? "rotate-90" : ""}`} /></button>
                </div>
              </div>
              {zOpen && (
                <div className="border-t border-border bg-background/40">
                  {zRacks.length === 0 && <div className="px-4 py-4 text-xs text-muted-foreground">No racks. Use "Add rack" above.</div>}
                  {zRacks.map((rk) => {
                    const rkRows = rows.filter((r) => r.rack_id === rk.id);
                    const rkOpen = openRacks.has(rk.id);
                    return (
                      <div key={rk.id} className="border-b border-border last:border-b-0">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pl-4 sm:pl-12 pr-4 py-2.5 hover:bg-secondary/30">
                          <button onClick={() => toggle(openRacks, setOpenRacks, rk.id)} className="flex items-center gap-2.5 text-left flex-1 min-w-0">
                            <Layers className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">{rk.name}</span>
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-secondary text-secondary-foreground">{rkRows.length} {rkRows.length === 1 ? "row" : "rows"}</span>
                          </button>
                          <div className="flex items-center gap-1.5 flex-wrap justify-end">
                            <button onClick={() => addRow(rk.id)} className="text-xs px-2.5 py-1 rounded border border-dashed border-primary/40 text-primary hover:bg-primary/5 flex items-center gap-1"><Plus className="h-3 w-3" /> Add row</button>
                            <IconBtn onClick={() => renameOrDelete("racks", rk, "rename")} variant="edit" />
                            <IconBtn onClick={() => renameOrDelete("racks", rk, "delete")} variant="delete" />
                            <button onClick={() => toggle(openRacks, setOpenRacks, rk.id)} className="p-1.5 rounded hover:bg-secondary"><ChevronRight className={`h-4 w-4 transition-transform ${rkOpen ? "rotate-90" : ""}`} /></button>
                          </div>
                        </div>
                        {rkOpen && (
                          <div>
                            <div className="pl-4 sm:pl-16 pr-4 pb-3">
                              <AdminLabelTools
                                type="rack"
                                id={rk.id}
                                name={rk.name}
                                subtitle={z.name}
                                nfcTagId={rk.nfc_tag_id}
                                onRegistered={reload}
                              />
                            </div>
                            {rkRows.length === 0 && <div className="px-4 sm:px-16 py-3 text-xs text-muted-foreground">No rows. Use "Add row" above.</div>}
                            {rkRows.map((ro) => {
                              const roSlots = slots.filter((s) => s.row_id === ro.id);
                              const roOpen = openRows.has(ro.id);
                              return (
                                <div key={ro.id}>
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pl-4 sm:pl-20 pr-4 py-2 hover:bg-secondary/30">
                                    <button onClick={() => toggle(openRows, setOpenRows, ro.id)} className="flex items-center gap-2.5 text-left flex-1 min-w-0">
                                      <Layers className="h-3.5 w-3.5 text-muted-foreground opacity-70" />
                                      <span className="text-sm">{ro.name}</span>
                                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-secondary text-secondary-foreground">{roSlots.length} {roSlots.length === 1 ? "slot" : "slots"}</span>
                                    </button>
                                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                      <button onClick={() => addSlot(ro.id)} className="text-xs px-2.5 py-1 rounded border border-dashed border-primary/40 text-primary hover:bg-primary/5 flex items-center gap-1"><Plus className="h-3 w-3" /> Add slot</button>
                                      <IconBtn onClick={() => renameOrDelete("rows", ro, "rename")} variant="edit" />
                                      <IconBtn onClick={() => renameOrDelete("rows", ro, "delete")} variant="delete" />
                                      <button onClick={() => toggle(openRows, setOpenRows, ro.id)} className="p-1.5 rounded hover:bg-secondary"><ChevronRight className={`h-4 w-4 transition-transform ${roOpen ? "rotate-90" : ""}`} /></button>
                                    </div>
                                  </div>
                                  {roOpen && (
                                    <>
                                      <div className="hidden sm:block pl-24 pr-4 pb-3 pt-1 overflow-x-auto">
                                        <table className="w-full min-w-[560px] text-sm border-collapse">
                                          <thead>
                                            <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                                              <th className="text-left font-medium py-2 pr-4">Slot</th>
                                              <th className="text-left font-medium py-2 pr-4">Status</th>
                                              <th className="text-left font-medium py-2 pr-4">Fixture assigned</th>
                                              <th className="text-right font-medium py-2">Actions</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {roSlots.map((sl) => {
                                              const fx = slotFx.get(sl.id);
                                              return (
                                                <tr key={sl.id} className="border-t border-border/60">
                                                  <td className="py-2 pr-4 font-mono text-xs">{sl.name}</td>
                                                  <td className="py-2 pr-4">
                                                    <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded ${sl.is_occupied || fx ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30" : "bg-secondary text-muted-foreground border border-border"}`}>
                                                      {sl.is_occupied || fx ? "Occupied" : "Empty"}
                                                    </span>
                                                  </td>
                                                  <td className="py-2 pr-4">
                                                    {fx ? (
                                                      <span><span className="font-mono text-xs text-muted-foreground">{fx.fixture_id}</span> - {fx.name}</span>
                                                    ) : <span className="text-muted-foreground">—</span>}
                                                  </td>
                                                  <td className="py-2 text-right">
                                                    <div className="inline-flex gap-1">
                                                      <IconBtn onClick={() => renameOrDelete("slots", sl, "rename")} variant="edit" />
                                                      <IconBtn onClick={() => renameOrDelete("slots", sl, "delete")} variant="delete" />
                                                    </div>
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                            {roSlots.length === 0 && (
                                              <tr><td colSpan={4} className="py-3 text-xs text-muted-foreground">No slots yet.</td></tr>
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                      <div className="sm:hidden px-4 pb-3 space-y-2">
                                        {roSlots.map((sl) => {
                                          const fx = slotFx.get(sl.id);
                                          return (
                                            <MobileCard key={sl.id} title={sl.name}>
                                              <MobileField label="Status">{sl.is_occupied || fx ? "Occupied" : "Empty"}</MobileField>
                                              <MobileField label="Fixture">{fx ? `${fx.fixture_id} - ${fx.name}` : "—"}</MobileField>
                                              <div className="col-span-2 flex justify-end gap-1 pt-1">
                                                <IconBtn onClick={() => renameOrDelete("slots", sl, "rename")} variant="edit" />
                                                <IconBtn onClick={() => renameOrDelete("slots", sl, "delete")} variant="delete" />
                                              </div>
                                            </MobileCard>
                                          );
                                        })}
                                        {roSlots.length === 0 && <EmptyMobileCard>No slots yet.</EmptyMobileCard>}
                                      </div>
                                    </>
                                  )}
                                  {roOpen && (
                                    <div className="pl-4 sm:pl-24 pr-4 pb-3">
                                      <AdminLabelTools
                                        type="row"
                                        id={ro.id}
                                        name={ro.name}
                                        subtitle={rk.name}
                                        nfcTagId={ro.nfc_tag_id}
                                        onRegistered={reload}
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {zones.length === 0 && <div className="text-sm text-muted-foreground rounded-xl border border-dashed border-border p-8 text-center">No zones yet. Click "Add zone" to start.</div>}
      </div>
    </div>
  );
}

function IconBtn({ onClick, variant }: { onClick: () => void; variant: "edit" | "delete" }) {
  if (variant === "edit") {
    return (
      <button onClick={onClick} aria-label="Edit" className="p-1.5 rounded border border-border bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground">
        <Pencil className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <button onClick={onClick} aria-label="Delete" className="p-1.5 rounded border border-destructive/40 bg-destructive/10 hover:bg-destructive/20 text-destructive">
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

// ============= FIXTURE TYPES =============
function FixtureTypes() {
  const { t } = useI18n();
  const [types, setTypes] = useState<{ id: string; code: string; name: string; description: string | null }[]>([]);
  const reload = async () => { const { data } = await supabase.from("fixture_types").select("*").order("code"); setTypes((data as typeof types) ?? []); };
  useEffect(() => { reload(); }, []);
  const add = async () => {
    const code = prompt("Type code (3 digits e.g. 001)?")?.trim();
    if (!code || !/^\d{3}$/.test(code)) { toast.error("Code must be 3 digits"); return; }
    const name = prompt("Type name?")?.trim();
    if (!name) return;
    const desc = prompt("Description? (optional)")?.trim() || null;
    const { error } = await supabase.from("fixture_types").insert({ code, name: sanitizeText(name, 100), description: desc ? sanitizeText(desc, 500) : null });
    if (error) toast.error("Type could not be created. Check code and name."); else reload();
  };
  const edit = async (row: { id: string; code: string; name: string; description: string | null }) => {
    const code = prompt("Type code (3 digits e.g. 001)?", row.code)?.trim();
    if (!code || !/^\d{3}$/.test(code)) { toast.error("Code must be 3 digits"); return; }
    const name = prompt("Type name?", row.name)?.trim();
    if (!name) { toast.error("Name is required"); return; }
    const desc = prompt("Description? (optional)", row.description ?? "")?.trim() || null;
    const { error } = await supabase.from("fixture_types").update({ code, name: sanitizeText(name, 100), description: desc ? sanitizeText(desc, 500) : null }).eq("id", row.id);
    if (error) toast.error("Type could not be updated. Check code and name."); else { toast.success("Type updated"); reload(); }
  };
  const remove = async (row: { id: string; name: string }) => {
    if (!confirm(`Delete fixture type "${row.name}"?`)) return;
    const { error } = await supabase.from("fixture_types").delete().eq("id", row.id);
    if (error) toast.error("Type is used by fixtures. Move those fixtures to another type first."); else { toast.success("Type deleted"); reload(); }
  };
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-4">
        <h1 className="text-2xl font-semibold">{t("admin.fixture_types")}</h1>
        <button onClick={add} className="w-full sm:w-auto justify-center bg-primary text-primary-foreground px-3 py-2 rounded text-sm flex items-center gap-1"><Plus className="h-4 w-4" /> {t("admin.add_type")}</button>
      </div>
      <div className="hidden md:block rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary"><tr><th className="text-left p-2">{t("admin.code")}</th><th className="text-left p-2">{t("admin.name")}</th><th className="text-left p-2">{t("admin.description")}</th><th className="text-right p-2">{t("admin.actions")}</th></tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="p-2 font-mono">{t.code}</td>
                <td className="p-2">{t.name}</td>
                <td className="p-2 text-muted-foreground">{t.description ?? "—"}</td>
                <td className="p-2 text-right"><div className="inline-flex gap-1"><IconBtn onClick={() => edit(t)} variant="edit" /><IconBtn onClick={() => remove(t)} variant="delete" /></div></td>
              </tr>
            ))}
            {types.length === 0 && <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">{t("admin.no_types")}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="md:hidden space-y-2">
        {types.map((row) => (
          <MobileCard key={row.id} title={row.name} subtitle={row.code}>
            <MobileField label={t("admin.description")} full>{row.description ?? "—"}</MobileField>
            <div className="col-span-2 flex justify-end gap-1 pt-1">
              <IconBtn onClick={() => edit(row)} variant="edit" />
              <IconBtn onClick={() => remove(row)} variant="delete" />
            </div>
          </MobileCard>
        ))}
        {types.length === 0 && <EmptyMobileCard>{t("admin.no_types")}</EmptyMobileCard>}
      </div>
    </div>
  );
}

// ============= FIXTURES =============
type View = { kind: "list" } | { kind: "detail"; id: string } | { kind: "assign" };

function Fixtures() {
  const [view, setView] = useState<View>({ kind: "list" });
  if (view.kind === "detail") return <FixtureDetail id={view.id} onBack={() => setView({ kind: "list" })} />;
  if (view.kind === "assign") return <BulkAssign onBack={() => setView({ kind: "list" })} />;
  return <FixturesList onOpen={(id) => setView({ kind: "detail", id })} onAssign={() => setView({ kind: "assign" })} />;
}

function FixturesList({ onOpen, onAssign }: { onOpen: (id: string) => void; onAssign: () => void }) {
  const [list, setList] = useState<FixtureWithLocation[]>([]);
  const [q, setQ] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [zones, setZones] = useState<{ id: string; name: string }[]>([]);
  const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  const reload = async () => {
    const { data } = await supabase.from("fixtures").select(FIXTURE_LOCATION_SELECT).order("fixture_id");
    setList((data as unknown as FixtureWithLocation[]) ?? []);
  };
  useEffect(() => {
    reload();
    supabase.from("zones").select("id,name").order("name").then(({ data }) => setZones((data as { id: string; name: string }[]) ?? []));
    supabase.from("fixture_types").select("id,name").order("name").then(({ data }) => setTypes((data as { id: string; name: string }[]) ?? []));
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return list.filter((f) => {
      if (term) {
        const hay = `${f.fixture_id} ${f.name} ${f.model_number ?? ""} ${f.fixture_types?.name ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (typeFilter && f.fixture_type_id !== typeFilter) return false;
      if (statusFilter && f.status !== statusFilter) return false;
      if (zoneFilter && f.current_slot?.row?.rack?.zone?.id !== zoneFilter) return false;
      return true;
    });
  }, [list, q, zoneFilter, typeFilter, statusFilter]);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-4">
        <h1 className="text-2xl font-semibold">Fixtures</h1>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button onClick={onAssign} className="justify-center border border-border text-foreground px-3 py-2 rounded text-sm flex items-center gap-1"><MapPin className="h-4 w-4" /> Assign</button>
          <button onClick={() => setShowAdd(true)} className="justify-center bg-primary text-primary-foreground px-3 py-2 rounded text-sm flex items-center gap-1"><Plus className="h-4 w-4" /> Add fixture</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ID, name, model, type…" className="rounded border border-border px-3 py-2 bg-background text-sm" />
        <select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)} className="rounded border border-border px-3 py-2 bg-background text-sm">
          <option value="">All zones</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded border border-border px-3 py-2 bg-background text-sm">
          <option value="">All types</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded border border-border px-3 py-2 bg-background text-sm">
          <option value="">All statuses</option>
          <option value="available">Available</option>
          <option value="checked_out">Checked out</option>
          <option value="maintenance">Maintenance</option>
        </select>
      </div>

      <div className="hidden md:block rounded-xl border border-border bg-card overflow-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-secondary"><tr>
            <th className="text-left p-2">Fixture ID</th>
            <th className="text-left p-2">Name</th>
            <th className="text-left p-2">Model</th>
            <th className="text-left p-2">Type</th>
            <th className="text-left p-2">Location</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">NFC</th>
            <th></th>
          </tr></thead>
          <tbody>
            {filtered.map((f) => {
              const path = locationPathText(f);
              return (
                <tr key={f.id} className="border-t border-border">
                  <td className="p-2 font-mono text-xs">{f.fixture_id}</td>
                  <td className="p-2">{f.name}</td>
                  <td className="p-2">{f.model_number || <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-2">{f.fixture_types?.name ?? "—"}</td>
                  <td className="p-2">{path ? <span className="text-xs">{path}</span> : <span className="text-xs text-red-600">Not assigned</span>}</td>
                  <td className="p-2"><StatusBadge status={f.status} /></td>
                  <td className="p-2">
                    <div className="space-y-1">
                      <NfcBadge tagId={f.nfc_tag_id ?? null} />
                      <RegisterNFCButton entityType="fixture" entityId={f.id} table="fixtures" onRegistered={reload} compact />
                    </div>
                  </td>
                  <td className="p-2 text-right">
                    <button onClick={() => onOpen(f.id)} className="text-xs text-primary underline">Open</button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={8} className="p-3 text-center text-muted-foreground">No fixtures.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="md:hidden space-y-2">
        {filtered.map((f) => {
          const path = locationPathText(f);
          return (
            <MobileCard key={f.id} title={f.name} subtitle={f.fixture_id}>
              <MobileField label="Model">{f.model_number || "—"}</MobileField>
              <MobileField label="Type">{f.fixture_types?.name ?? "—"}</MobileField>
              <MobileField label="Location" full>{path || <span className="text-red-600">Not assigned</span>}</MobileField>
              <MobileField label="Status"><StatusBadge status={f.status} /></MobileField>
              <MobileField label="NFC"><NfcBadge tagId={f.nfc_tag_id ?? null} /></MobileField>
              <div className="col-span-2 flex items-center justify-between gap-2 pt-1">
                <RegisterNFCButton entityType="fixture" entityId={f.id} table="fixtures" onRegistered={reload} compact />
                <button onClick={() => onOpen(f.id)} className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground">Open</button>
              </div>
            </MobileCard>
          );
        })}
        {filtered.length === 0 && <EmptyMobileCard>No fixtures.</EmptyMobileCard>}
      </div>

      {showAdd && <AddFixtureModal onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); reload(); }} />}
    </div>
  );
}

// ============= FIXTURE DETAIL =============
function FixtureDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [fx, setFx] = useState<FixtureWithLocation | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  type Tx = { id: string; checked_out_at: string; returned_at: string | null; status: string; worker: { full_name: string; employee_id: string } | null; gatekeeper: { full_name: string } | null };
  const [txs, setTxs] = useState<Tx[]>([]);

  const load = async () => {
    const { data } = await supabase.from("fixtures").select(FIXTURE_LOCATION_SELECT).eq("id", id).maybeSingle();
    setFx((data as unknown as FixtureWithLocation) ?? null);
    const { data: t } = await supabase.from("transactions")
      .select("id,checked_out_at,returned_at,status,worker:profiles!transactions_worker_id_fkey(full_name,employee_id),gatekeeper:profiles!transactions_gatekeeper_id_fkey(full_name)")
      .eq("fixture_id", id).order("checked_out_at", { ascending: false });
    setTxs((t as unknown as Tx[]) ?? []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!fx) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const path = locationPathText(fx);
  const p = locationParts(fx);

  const printUrl = `/print-label?id=${encodeURIComponent(fx.id)}`;

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-xs text-muted-foreground flex items-center gap-1"><ChevronLeft className="h-3 w-3" /> Back</button>

      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <div className="font-mono font-bold text-3xl">{fx.fixture_id}</div>
          <div className="text-2xl mt-1">{fx.name}</div>
          <div className="text-sm text-muted-foreground mt-1">
            <span className="font-medium">Model Number:</span>{" "}
            {fx.model_number ? <span>{fx.model_number}</span> : <span className="text-muted-foreground">—</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <StatusBadge status={fx.status} />
          <NfcBadge tagId={fx.nfc_tag_id ?? null} />
          <button onClick={() => setShowEdit(true)} className="text-xs px-3 py-1.5 rounded border border-border flex items-center gap-1"><Pencil className="h-3 w-3" /> Edit</button>
          <a href={printUrl} target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground flex items-center gap-1"><Printer className="h-3 w-3" /> Print Label</a>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
          <Row label="Type">{fx.fixture_types?.name ?? "—"}</Row>
          <Row label="Location">
            {p ? (
              <span className="flex items-center gap-1 flex-wrap">
                <MapPin className="h-3 w-3" />
                {p.zone} <ChevronRight className="h-3 w-3" /> {p.rack} <ChevronRight className="h-3 w-3" /> {p.row} <ChevronRight className="h-3 w-3" /> {p.slot}
              </span>
            ) : <span className="text-red-600 text-xs">Not assigned</span>}
          </Row>
          <Row label="Weight">{fx.weight_kg != null ? `${fx.weight_kg} kg` : "—"}</Row>
          <Row label="Description">{fx.description ?? "—"}</Row>
          <Row label="NFC Tag">
            <span className={fx.nfc_tag_id ? "font-mono text-xs" : "text-red-600 text-xs"}>{fx.nfc_tag_id ?? "Not registered"}</span>
          </Row>
          <RegisterNFCButton
            entityType="fixture"
            entityId={fx.id}
            table="fixtures"
            onRegistered={load}
          />
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground mb-2">Codes</div>
          <div className="grid gap-3 sm:grid-cols-2 items-center">
            <div className="bg-white p-3 rounded flex items-center justify-center">
              <QRBlock value={fx.fixture_id} />
            </div>
            <div className="bg-white p-3 rounded flex items-center justify-center">
              <BarcodeBlock value={fx.fixture_id} />
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="font-semibold text-sm mb-2">Transaction history</h2>
        <div className="hidden md:block rounded-xl border border-border bg-card overflow-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-secondary"><tr><th className="text-left p-2">Checked out</th><th className="text-left p-2">Returned</th><th className="text-left p-2">Worker</th><th className="text-left p-2">Gatekeeper</th><th className="text-left p-2">Status</th></tr></thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="p-2">{new Date(t.checked_out_at).toLocaleString()}</td>
                  <td className="p-2">{t.returned_at ? new Date(t.returned_at).toLocaleString() : "—"}</td>
                  <td className="p-2">{t.worker?.full_name ?? "—"} <span className="font-mono text-xs text-muted-foreground">{t.worker?.employee_id}</span></td>
                  <td className="p-2">{t.gatekeeper?.full_name ?? "—"}</td>
                  <td className="p-2">{t.status}</td>
                </tr>
              ))}
              {txs.length === 0 && <tr><td colSpan={5} className="p-3 text-center text-muted-foreground">No history yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="md:hidden space-y-2">
          {txs.map((t) => (
            <MobileCard key={t.id} title={new Date(t.checked_out_at).toLocaleString()} subtitle={t.status}>
              <MobileField label="Returned">{t.returned_at ? new Date(t.returned_at).toLocaleString() : "—"}</MobileField>
              <MobileField label="Worker">{t.worker?.full_name ?? "—"}</MobileField>
              <MobileField label="Employee ID">{t.worker?.employee_id ?? "—"}</MobileField>
              <MobileField label="Gatekeeper">{t.gatekeeper?.full_name ?? "—"}</MobileField>
            </MobileCard>
          ))}
          {txs.length === 0 && <EmptyMobileCard>No history yet.</EmptyMobileCard>}
        </div>
      </div>

      {showEdit && <EditFixtureModal fixture={fx} onClose={() => setShowEdit(false)} onDone={() => { setShowEdit(false); load(); }} />}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex gap-3"><div className="w-24 text-xs text-muted-foreground">{label}</div><div className="flex-1">{children}</div></div>;
}

function QRBlock({ value, size = 140 }: { value: string; size?: number }) {
  return <QRCode value={value} size={size} />;
}

function BarcodeBlock({ value, compact = false }: { value: string; compact?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      bwipjs.toCanvas(ref.current, {
        bcid: "code128",
        text: value,
        scale: compact ? 1 : 2,
        height: compact ? 10 : 12,
        includetext: !compact,
        textxalign: "center",
      });
    } catch { /* noop */ }
  }, [value, compact]);
  return <canvas ref={ref} className="block h-auto w-full max-w-full" />;
}

function NfcBadge({ tagId }: { tagId: string | null }) {
  return tagId ? (
    <span className="text-[10px] uppercase font-semibold px-2 py-1 rounded bg-green-100 text-green-800">NFC ✓</span>
  ) : (
    <span className="text-[10px] uppercase font-semibold px-2 py-1 rounded bg-red-100 text-red-800">No NFC</span>
  );
}

function AdminLabelTools({
  type,
  id,
  name,
  subtitle,
  nfcTagId,
  onRegistered,
}: {
  type: "rack" | "row";
  id: string;
  name: string;
  subtitle: string;
  nfcTagId: string | null;
  onRegistered: () => void;
}) {
  const printUrl = `/print-label?type=${type}&id=${encodeURIComponent(id)}`;
  return (
    <div className="rounded-lg border border-border bg-card/70 p-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{type} label</div>
          <div className="text-sm font-semibold">{name}</div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
          <div className="mt-1 font-mono text-[11px] break-all text-muted-foreground">{id}</div>
          <div className="mt-2 text-xs">
            NFC Tag:{" "}
            <span className={nfcTagId ? "font-mono" : "text-red-600"}>{nfcTagId ?? "Not registered"}</span>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[140px_minmax(220px,1fr)] xl:grid-cols-1">
          <div className="bg-white p-2 rounded border border-border flex items-center justify-center">
            <QRBlock value={id} size={132} />
          </div>
          <div className="bg-white p-2 rounded border border-border overflow-hidden">
            <BarcodeBlock value={id} compact />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={printUrl} target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground flex items-center gap-1">
          <Printer className="h-3 w-3" /> Print {type === "rack" ? "Rack" : "Row"} Label
        </a>
        <RegisterNFCButton entityType={type} entityId={id} table={type === "rack" ? "racks" : "rows"} onRegistered={onRegistered} />
      </div>
    </div>
  );
}

function RegisterNFCButton({
  entityType,
  entityId,
  table,
  onRegistered,
  compact = false,
}: {
  entityType: "rack" | "row" | "fixture";
  entityId: string;
  table: "racks" | "rows" | "fixtures";
  onRegistered: () => void;
  compact?: boolean;
}) {
  const { profile } = useAuth();
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { isSupported, isScanning } = useNFCScan({
    active,
    onScan: async ({ tagId }) => {
      setActive(false);
      const { error } = await supabase.from(table).update({ nfc_tag_id: tagId }).eq("id", entityId);
      if (error) {
        toast.error(error.message);
        setMessage(error.message);
        return;
      }
      await supabase.from("nfc_registration_log").insert({
        registered_by: profile?.id ?? null,
        entity_type: entityType,
        entity_id: entityId,
        nfc_tag_id: tagId,
      });
      toast.success(`NFC registered: ${tagId}`);
      setMessage(`Registered ${tagId}`);
      onRegistered();
    },
    onError: (error) => {
      toast.error(error);
      setMessage(error);
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={!isSupported}
        title={isSupported ? "Register NFC tag" : "Requires Android Chrome"}
        onClick={() => {
          setMessage(null);
          setActive(true);
        }}
        className={`text-xs rounded border flex items-center gap-1 disabled:opacity-50 ${compact ? "px-2 py-1" : "px-3 py-1.5"} ${
          isScanning ? "border-green-500 bg-green-50 text-green-800 animate-pulse" : "border-border bg-background"
        }`}
      >
        <Radio className="h-3 w-3" /> {isScanning ? "Tap tag..." : compact ? "Register" : "Register NFC"}
      </button>
      {message && <span className="text-[11px] text-muted-foreground">{message}</span>}
    </div>
  );
}

// ============= ADD / EDIT FIXTURE =============
function AddFixtureModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [typeId, setTypeId] = useState("");
  const [weight, setWeight] = useState("");
  const [desc, setDesc] = useState("");
  const [slotId, setSlotId] = useState<string | null>(null);
  const [types, setTypes] = useState<{ id: string; code: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("fixture_types").select("id,code,name").order("code").then(({ data }) => setTypes((data as { id: string; code: string; name: string }[]) ?? []));
  }, []);

  const save = async () => {
    const type = types.find((t) => t.id === typeId);
    if (!type || !name) { toast.error("Name and type are required"); return; }
    setBusy(true);
    const { data: cur } = await supabase.from("fixture_id_counters").select("last_number").eq("fixture_type_code", type.code).maybeSingle();
    const next = ((cur as { last_number: number } | null)?.last_number ?? 0) + 1;
    await supabase.from("fixture_id_counters").upsert({ fixture_type_code: type.code, last_number: next });
    const fixture_id = `FX-${type.code}-${String(next).padStart(4, "0")}`;

    const { error } = await supabase.from("fixtures").insert({
      fixture_id,
      name: sanitizeText(name, 100),
      model_number: model ? sanitizeText(model, 100) : null,
      fixture_type_id: typeId,
      home_slot_id: slotId,
      current_slot_id: slotId,
      weight_kg: weight ? Number(weight) : null,
      description: desc ? sanitizeText(desc, 500) : null,
      status: "available",
    });
    if (error) { toast.error(error.message); setBusy(false); return; }
    if (slotId) await supabase.from("slots").update({ is_occupied: true }).eq("id", slotId);
    toast.success(`Created ${fixture_id}`);
    onDone();
  };

  return (
    <Modal onClose={onClose} title="Add fixture">
      <div className="space-y-3 text-sm">
        <Field label="Fixture Name">
          <input className="w-full rounded border border-border px-3 py-2 bg-background" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Turning Fixture Type A" />
        </Field>
        <Field label="Model Number">
          <input className="w-full rounded border border-border px-3 py-2 bg-background" maxLength={100} value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. NGF-2200, MT-4500-B" />
        </Field>
        <Field label="Type">
          <select className="w-full rounded border border-border px-3 py-2 bg-background" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">Select…</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Weight (kg)"><input type="number" className="w-full rounded border border-border px-3 py-2 bg-background" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
          <Field label="Description"><input className="w-full rounded border border-border px-3 py-2 bg-background" maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Home Slot</div>
          <LocationCascader value={slotId} onChange={setSlotId} />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <button onClick={onClose} className="px-3 py-2 text-sm rounded border border-border">Cancel</button>
        <button disabled={busy} onClick={save} className="px-3 py-2 text-sm rounded bg-accent text-accent-foreground disabled:opacity-50">{busy ? "Creating…" : "Create"}</button>
      </div>
    </Modal>
  );
}

function EditFixtureModal({ fixture, onClose, onDone }: { fixture: FixtureWithLocation; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(fixture.name);
  const [model, setModel] = useState(fixture.model_number ?? "");
  const [weight, setWeight] = useState(fixture.weight_kg != null ? String(fixture.weight_kg) : "");
  const [desc, setDesc] = useState(fixture.description ?? "");
  const [status, setStatus] = useState(fixture.status);
  const [slotId, setSlotId] = useState<string | null>(fixture.current_slot_id);
  const [busy, setBusy] = useState(false);
  const originalSlot = fixture.current_slot_id;

  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from("fixtures").update({
      name: sanitizeText(name, 100),
      model_number: model ? sanitizeText(model, 100) : null,
      weight_kg: weight ? Number(weight) : null,
      description: desc ? sanitizeText(desc, 500) : null,
      status,
      home_slot_id: slotId,
      current_slot_id: slotId,
    }).eq("id", fixture.id);
    if (error) { toast.error(error.message); setBusy(false); return; }
    if (originalSlot !== slotId) {
      if (originalSlot) await supabase.from("slots").update({ is_occupied: false }).eq("id", originalSlot);
      if (slotId) await supabase.from("slots").update({ is_occupied: true }).eq("id", slotId);
    }
    toast.success("Updated");
    onDone();
  };

  return (
    <Modal onClose={onClose} title="Edit fixture">
      <div className="space-y-3 text-sm">
        <Field label="Fixture Name"><input className="w-full rounded border border-border px-3 py-2 bg-background" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Model Number"><input className="w-full rounded border border-border px-3 py-2 bg-background" maxLength={100} value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. NGF-2200, MT-4500-B" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Weight (kg)"><input type="number" className="w-full rounded border border-border px-3 py-2 bg-background" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
          <Field label="Status">
            <select className="w-full rounded border border-border px-3 py-2 bg-background" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="available">Available</option>
              <option value="checked_out">Checked out</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </Field>
        </div>
        <Field label="Description"><input className="w-full rounded border border-border px-3 py-2 bg-background" maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Home Slot</div>
          <LocationCascader value={slotId} onChange={setSlotId} includeSlotId={originalSlot} />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <button onClick={onClose} className="px-3 py-2 text-sm rounded border border-border">Cancel</button>
        <button disabled={busy} onClick={save} className="px-3 py-2 text-sm rounded bg-accent text-accent-foreground disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50" onClick={onClose}>
      <div className="bg-card rounded-t-xl sm:rounded-xl p-4 sm:p-6 max-w-lg w-full max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <label className="block">
      <span className={`block text-xs mb-1 ${error ? "text-destructive" : "text-muted-foreground"}`}>{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-destructive">{error}</span>}
    </label>
  );
}

// ============= BULK ASSIGN =============
function BulkAssign({ onBack }: { onBack: () => void }) {
  const [list, setList] = useState<FixtureWithLocation[]>([]);
  const [editing, setEditing] = useState<FixtureWithLocation | null>(null);

  const reload = async () => {
    const { data } = await supabase.from("fixtures").select(FIXTURE_LOCATION_SELECT).order("fixture_id");
    setList((data as unknown as FixtureWithLocation[]) ?? []);
  };
  useEffect(() => { reload(); }, []);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-xs text-muted-foreground flex items-center gap-1"><ChevronLeft className="h-3 w-3" /> Back to fixtures</button>
      <h1 className="text-2xl font-semibold">Assign Locations</h1>
      <p className="text-sm text-muted-foreground">Assign each fixture to its physical storage slot. Page stays open so you can assign one after another.</p>
      <div className="hidden md:block rounded-xl border border-border bg-card overflow-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-secondary"><tr>
            <th className="text-left p-2">Fixture ID</th>
            <th className="text-left p-2">Model</th>
            <th className="text-left p-2">Name</th>
            <th className="text-left p-2">Type</th>
            <th className="text-left p-2">Current Location</th>
            <th></th>
          </tr></thead>
          <tbody>
            {list.map((f) => {
              const path = locationPathText(f);
              return (
                <tr key={f.id} className="border-t border-border">
                  <td className="p-2 font-mono text-xs">{f.fixture_id}</td>
                  <td className="p-2">{f.model_number || <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-2">{f.name}</td>
                  <td className="p-2">{f.fixture_types?.name ?? "—"}</td>
                  <td className="p-2">{path ?? <span className="text-red-600 text-xs">Not assigned</span>}</td>
                  <td className="p-2 text-right"><button onClick={() => setEditing(f)} className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground">Edit Location</button></td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={6} className="p-3 text-center text-muted-foreground">No fixtures.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="md:hidden space-y-2">
        {list.map((f) => {
          const path = locationPathText(f);
          return (
            <MobileCard key={f.id} title={f.name} subtitle={f.fixture_id}>
              <MobileField label="Model">{f.model_number || "—"}</MobileField>
              <MobileField label="Type">{f.fixture_types?.name ?? "—"}</MobileField>
              <MobileField label="Current Location" full>{path ?? <span className="text-red-600">Not assigned</span>}</MobileField>
              <div className="col-span-2 flex justify-end pt-1">
                <button onClick={() => setEditing(f)} className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground">Edit Location</button>
              </div>
            </MobileCard>
          );
        })}
        {list.length === 0 && <EmptyMobileCard>No fixtures.</EmptyMobileCard>}
      </div>
      {editing && <AssignSlotModal fixture={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function AssignSlotModal({ fixture, onClose, onSaved }: { fixture: FixtureWithLocation; onClose: () => void; onSaved: () => void }) {
  const [slotId, setSlotId] = useState<string | null>(fixture.current_slot_id);
  const [busy, setBusy] = useState(false);
  const originalSlot = fixture.current_slot_id;

  const save = async () => {
    if (slotId === originalSlot) { onClose(); return; }
    setBusy(true);
    const { error } = await supabase.from("fixtures").update({ home_slot_id: slotId, current_slot_id: slotId }).eq("id", fixture.id);
    if (error) { toast.error(error.message); setBusy(false); return; }
    if (originalSlot) await supabase.from("slots").update({ is_occupied: false }).eq("id", originalSlot);
    if (slotId) await supabase.from("slots").update({ is_occupied: true }).eq("id", slotId);
    toast.success(`${fixture.fixture_id} location updated`);
    onSaved();
  };

  return (
    <Modal onClose={onClose} title={`Assign location · ${fixture.fixture_id}`}>
      <div className="text-sm text-muted-foreground mb-3">{fixture.name}{fixture.model_number ? ` · Model: ${fixture.model_number}` : ""}</div>
      <LocationCascader value={slotId} onChange={setSlotId} includeSlotId={originalSlot} />
      <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <button onClick={onClose} className="px-3 py-2 text-sm rounded border border-border">Close</button>
        <button disabled={busy} onClick={save} className="px-3 py-2 text-sm rounded bg-accent text-accent-foreground disabled:opacity-50">{busy ? "Saving…" : "Save location"}</button>
      </div>
    </Modal>
  );
}

// ============= ACCOUNTS =============
function Accounts({ role }: { role: "worker" | "gatekeeper" }) {
  const { t } = useI18n();
  type Acc = { id: string; full_name: string; employee_id: string; department: string | null; phone: string | null; is_active: boolean };
  const [list, setList] = useState<Acc[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const reload = async () => {
    const { data } = await supabase.from("profiles").select("id,full_name,employee_id,department,phone,is_active").eq("role", role).order("full_name");
    setList((data as Acc[]) ?? []);
  };
  useEffect(() => { reload(); }, [role]);

  const toggle = async (a: Acc) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) return;
    try {
      await setAccountActive({ data: { callerAccessToken: token, userId: a.id, active: !a.is_active } });
      toast.success(a.is_active ? "Deactivated" : "Activated");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-4">
        <h1 className="text-2xl font-semibold capitalize">{role === "worker" ? t("admin.workers") : t("admin.gatekeepers")}</h1>
        <button onClick={() => setShowAdd(true)} className="w-full sm:w-auto justify-center bg-primary text-primary-foreground px-3 py-2 rounded text-sm flex items-center gap-1"><Plus className="h-4 w-4" /> {role === "worker" ? t("admin.add_worker") : t("admin.add_gatekeeper")}</button>
      </div>
      <div className="hidden md:block rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary"><tr><th className="text-left p-2">{t("admin.name")}</th><th className="text-left p-2">{t("admin.employee_id")}</th><th className="text-left p-2">{t("admin.department")}</th><th className="text-left p-2">{t("admin.status")}</th><th></th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="p-2">{a.full_name}</td>
                <td className="p-2 font-mono text-xs">{a.employee_id}</td>
                <td className="p-2">{a.department ?? "—"}</td>
                <td className="p-2">{a.is_active ? <span className="text-green-700">{t("admin.active")}</span> : <span className="text-muted-foreground">{t("admin.inactive")}</span>}</td>
                <td className="p-2 text-right"><button onClick={() => toggle(a)} className="text-xs text-primary underline">{a.is_active ? t("admin.deactivate") : t("admin.activate")}</button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={5} className="p-3 text-center text-muted-foreground">No {role}s yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="md:hidden space-y-2">
        {list.map((a) => (
          <MobileCard key={a.id} title={a.full_name} subtitle={a.employee_id}>
            <MobileField label={t("admin.department")}>{a.department ?? "—"}</MobileField>
            <MobileField label={t("admin.status")}>{a.is_active ? <span className="text-green-700">{t("admin.active")}</span> : <span className="text-muted-foreground">{t("admin.inactive")}</span>}</MobileField>
            <MobileField label={t("admin.phone")} full>{a.phone ?? "—"}</MobileField>
            <div className="col-span-2 flex justify-end pt-1">
              <button onClick={() => toggle(a)} className="text-xs px-3 py-1.5 rounded border border-border text-primary">{a.is_active ? t("admin.deactivate") : t("admin.activate")}</button>
            </div>
          </MobileCard>
        ))}
        {list.length === 0 && <EmptyMobileCard>No {role}s yet.</EmptyMobileCard>}
      </div>
      {showAdd && <AddAccountModal role={role} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); reload(); }} />}
    </div>
  );
}

function AddAccountModal({ role, onClose, onDone }: { role: "worker" | "gatekeeper"; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ full_name: "", employee_id: "", email: "", password: "", department: "", phone: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const validate = () => {
    const next: Partial<Record<keyof typeof form, string>> = {};
    if (!form.full_name.trim()) next.full_name = t("form.name_required");
    if (!form.employee_id.trim()) next.employee_id = t("form.employee_required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = t("form.email_invalid");
    if (form.password.length < 8) next.password = t("form.password_min");
    else if (!/[A-Z]/.test(form.password)) next.password = t("form.password_capital");
    setErrors(next);
    setNotice(Object.keys(next).length ? t("form.fix_fields") : null);
    return Object.keys(next).length === 0;
  };
  const save = async () => {
    if (!validate()) return;
    setBusy(true);
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) { setBusy(false); return; }
    try {
      await createAccount({
        data: {
          callerAccessToken: token,
          email: form.email.trim().toLowerCase(),
          password: form.password,
          full_name: sanitizeText(form.full_name, 100),
          employee_id: sanitizeText(form.employee_id, 50),
          role,
          department: sanitizeText(form.department, 100) || null,
          phone: sanitizeText(form.phone, 30) || null,
        },
      });
      toast.success(`${role} created`);
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Please check the highlighted fields.";
      setNotice(msg);
      if (msg.toLowerCase().includes("email")) setErrors((old) => ({ ...old, email: msg }));
      else if (msg.toLowerCase().includes("password")) setErrors((old) => ({ ...old, password: msg }));
      else if (msg.toLowerCase().includes("employee")) setErrors((old) => ({ ...old, employee_id: msg }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal onClose={onClose} title={`Add ${role}`}>
      <div className="space-y-3 text-sm">
        {notice && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{notice}</div>}
        {(["full_name", "employee_id", "email", "password", "department", "phone"] as const).map((k) => {
          const labelMap = { full_name: t("admin.name"), employee_id: t("admin.employee_id"), email: t("auth.email"), password: t("auth.password"), department: t("admin.department"), phone: t("admin.phone") };
          const required = k === "full_name" || k === "employee_id" || k === "email" || k === "password";
          return (
            <Field key={k} label={`${labelMap[k]}${required ? " *" : ""}`} error={errors[k]}>
              <div className="relative">
                <input
                  type={k === "password" ? (showPassword ? "text" : "password") : k === "email" ? "email" : "text"}
                  value={form[k]}
                  maxLength={k === "password" ? 100 : k === "phone" ? 30 : 100}
                  onChange={(e) => { setForm({ ...form, [k]: e.target.value }); setErrors((old) => ({ ...old, [k]: undefined })); }}
                  className={`w-full rounded border px-3 py-2 bg-background outline-none focus:ring-2 ${errors[k] ? "border-destructive focus:ring-destructive/30" : "border-border focus:ring-primary/30"} ${k === "password" ? "pr-10" : ""}`}
                />
                {k === "password" && (
                  <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? t("auth.hide_password") : t("auth.show_password")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-muted-foreground hover:text-foreground">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                )}
              </div>
            </Field>
          );
        })}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <button onClick={onClose} className="px-3 py-2 text-sm rounded border border-border">{t("form.cancel")}</button>
        <button disabled={busy} onClick={save} className="px-3 py-2 text-sm rounded bg-accent text-accent-foreground disabled:opacity-50">{busy ? t("form.creating") : t("form.create")}</button>
      </div>
    </Modal>
  );
}
