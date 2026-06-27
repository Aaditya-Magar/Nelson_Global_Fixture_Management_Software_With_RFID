import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { ScannerButton } from "@/components/ScannerButton";
import { sanitizeText } from "@/lib/sanitize";
import { toast } from "sonner";
import { FIXTURE_LOCATION_SELECT, type FixtureWithLocation } from "@/lib/fixtures";
import { FixtureLocationBadge } from "@/components/FixtureLocationBadge";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/worker/search")({
  component: WorkerSearch,
});

type FixtureRow = FixtureWithLocation & {
  current_holder?: { full_name: string; checked_out_at: string } | null;
};

function WorkerSearch() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FixtureRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  // Pre-populate "already requested" set for active requests by this worker.
  useEffect(() => {
    if (!profile) return;
    supabase
      .from("requests")
      .select("id,status,request_items(fixture_id)")
      .eq("worker_id", profile.id)
      .in("status", ["pending", "preparing", "ready"])
      .then(({ data }) => {
        const set = new Set<string>();
        (data ?? []).forEach((r: { request_items: { fixture_id: string }[] }) => {
          r.request_items.forEach((i) => set.add(i.fixture_id));
        });
        setRequestedIds(set);
      });
  }, [profile]);

  useEffect(() => {
    const q = sanitizeText(query, 100);
    setLoading(true);
    const tt = setTimeout(async () => {
      let qb = supabase.from("fixtures").select(FIXTURE_LOCATION_SELECT).order("name").limit(40);
      if (q) {
        const safe = q.replace(/[%,]/g, "");
        const ors = [`name.ilike.%${safe}%`, `customer.ilike.%${safe}%`, `customer_no.ilike.%${safe}%`, `ngp_no.ilike.%${safe}%`, `fixture_id.ilike.%${safe}%`];
        qb = qb.or(ors.join(","));
      }
      const { data, error } = await qb;
      if (error) toast.error("Search failed");
      const fixtures = (data as unknown as FixtureRow[]) ?? [];

      const checkedOutIds = fixtures.filter((f) => f.status === "checked_out").map((f) => f.id);
      if (checkedOutIds.length) {
        const { data: txs } = await supabase
          .from("transactions")
          .select("fixture_id,checked_out_at,profiles!transactions_worker_id_fkey(full_name)")
          .in("fixture_id", checkedOutIds)
          .eq("status", "active");
        const map = new Map<string, { full_name: string; checked_out_at: string }>();
        (txs ?? []).forEach((t: { fixture_id: string; checked_out_at: string; profiles: { full_name: string } | { full_name: string }[] | null }) => {
          const prof = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles;
          if (prof) map.set(t.fixture_id, { full_name: prof.full_name, checked_out_at: t.checked_out_at });
        });
        fixtures.forEach((f) => { f.current_holder = map.get(f.id) ?? null; });
      }
      setResults(fixtures);
      setLoading(false);
    }, 250);
    return () => clearTimeout(tt);
  }, [query]);

  const handleScan = (text: string) => setQuery(text.trim());

  const requestFixture = async (f: FixtureRow) => {
    if (!profile) return;
    setBusyId(f.id);
    const { data: req, error: rErr } = await supabase
      .from("requests")
      .insert({ worker_id: profile.id, notes: null, status: "pending" })
      .select("id")
      .single();
    if (rErr || !req) { toast.error("Request failed"); setBusyId(null); return; }
    const reqId = (req as { id: string }).id;
    const { error: iErr } = await supabase
      .from("request_items")
      .insert({ request_id: reqId, fixture_id: f.id });
    if (iErr) { toast.error("Request failed"); setBusyId(null); return; }
    setRequestedIds((s) => new Set(s).add(f.id));
    toast.success("Request sent to gatekeeper");
    setBusyId(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={100}
            placeholder={t("worker.search_placeholder")}
            className="w-full rounded-md bg-card border border-border pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <ScannerButton onResult={handleScan} />
      </div>

      {loading && <div className="text-sm text-muted-foreground">{t("worker.searching")}</div>}
      {!loading && results.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">{t("worker.no_results")}</div>
      )}

      <div className="space-y-2">
        {results.map((f) => (
          <FixtureCard
            key={f.id}
            fixture={f}
            requested={requestedIds.has(f.id)}
            busy={busyId === f.id}
            onRequest={() => requestFixture(f)}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

function FixtureCard({ fixture, requested, busy, onRequest, t }: { fixture: FixtureRow; requested: boolean; busy: boolean; onRequest: () => void; t: (k: string) => string }) {
  const statusCls =
    fixture.status === "available" ? "bg-green-100 text-green-800"
    : fixture.status === "checked_out" ? "bg-red-100 text-red-800"
    : "bg-amber-100 text-amber-800";

  return (
    <div className="rounded-xl bg-card border border-border p-3.5">
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <div className="font-mono text-xs text-muted-foreground">{fixture.fixture_id}</div>
          <div className="font-medium truncate">{fixture.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Customer: {fixture.customer || "—"}</div>
          <div className="text-xs text-muted-foreground">Customer No.: {fixture.customer_no || "—"}</div>
          <div className="text-xs text-muted-foreground">NGP No.: {fixture.ngp_no || "—"}</div>
          <FixtureLocationBadge current_slot={fixture.current_slot} className="mt-1" />
        </div>
        <span className={`text-[10px] uppercase font-semibold px-2 py-1 rounded ${statusCls}`}>
          {fixture.status.replace("_", " ")}
        </span>
      </div>
      {fixture.status === "checked_out" && fixture.current_holder && (
        <div className="mt-2 text-xs text-muted-foreground">
          With {fixture.current_holder.full_name.split(" ")[0]} ·{" "}
          {Math.round((Date.now() - new Date(fixture.current_holder.checked_out_at).getTime()) / 3600000)}h ago
        </div>
      )}
      {fixture.status === "available" && (
        <div className="mt-3">
          {requested ? (
            <div className="text-sm text-green-700 font-medium">{t("worker.requested")}</div>
          ) : (
            <button
              disabled={busy}
              onClick={onRequest}
              className="rounded-md bg-primary text-primary-foreground text-sm px-3 py-1.5 font-medium disabled:opacity-60"
            >
              {busy ? "…" : t("worker.request")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
