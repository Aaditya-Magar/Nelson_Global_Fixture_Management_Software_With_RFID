import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import bwipjs from "bwip-js/browser";
import { supabase } from "@/lib/supabase";
import { FIXTURE_LOCATION_SELECT, locationPathText, type FixtureWithLocation } from "@/lib/fixtures";

export const Route = createFileRoute("/print-label")({
  head: () => ({ meta: [{ title: "Print Label" }, { name: "robots", content: "noindex" }] }),
  component: PrintLabel,
});

function PrintLabel() {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const type = (params.get("type") ?? "fixture") as "fixture" | "rack" | "row";
  const id = params.get("id") ?? "";
  const [fx, setFx] = useState<FixtureWithLocation | null>(null);
  const [rack, setRack] = useState<{ id: string; name: string; zones: { name: string } | null } | null>(null);
  const [row, setRow] = useState<{ id: string; name: string; racks: { name: string } | null } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!id) return;
    if (type === "rack") {
      supabase.from("racks").select("id,name,zones(name)").eq("id", id).maybeSingle().then(({ data }) => {
        setRack((data as unknown as { id: string; name: string; zones: { name: string } | null }) ?? null);
      });
      return;
    }
    if (type === "row") {
      supabase.from("rows").select("id,name,racks(name)").eq("id", id).maybeSingle().then(({ data }) => {
        setRow((data as unknown as { id: string; name: string; racks: { name: string } | null }) ?? null);
      });
      return;
    }
    supabase.from("fixtures").select(FIXTURE_LOCATION_SELECT).eq("id", id).maybeSingle().then(({ data }) => {
      setFx((data as unknown as FixtureWithLocation) ?? null);
    });
  }, [id, type]);

  useEffect(() => {
    const value = type === "rack" ? rack?.id : type === "row" ? row?.id : fx?.fixture_id;
    if (!value || !canvasRef.current) return;
    try {
      bwipjs.toCanvas(canvasRef.current, { bcid: "code128", text: value, scale: 3, height: 14, includetext: true, textxalign: "center" });
    } catch { /* noop */ }
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [fx, rack, row, type]);

  if (type === "rack" && !rack) return <div className="p-6 text-sm">Loading…</div>;
  if (type === "row" && !row) return <div className="p-6 text-sm">Loading…</div>;
  if (type === "fixture" && !fx) return <div className="p-6 text-sm">Loading…</div>;

  const label = type === "rack"
    ? { header: "RACK", title: rack!.name, subtitle: rack!.zones?.name ?? "Zone not assigned", code: rack!.id, loc: rack!.zones?.name ?? "Zone not assigned" }
    : type === "row"
      ? { header: "ROW", title: row!.name, subtitle: row!.racks?.name ?? "Rack not assigned", code: row!.id, loc: row!.racks?.name ?? "Rack not assigned" }
      : { header: "FIXTURE", title: fx!.name, subtitle: [fx!.customer_no ? `Customer No.: ${fx!.customer_no}` : "", fx!.ngp_no ? `NGP No.: ${fx!.ngp_no}` : ""].filter(Boolean).join(" | "), code: fx!.fixture_id, loc: locationPathText(fx) ?? "Location not assigned" };
  return (
    <div className="label-page">
      <style>{`
        @page { size: 4in 3in; margin: 0.25in; }
        @media print { body { margin: 0 } .label-page { box-shadow: none !important; border: none !important; } }
        body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: white; }
        .label-page { width: 4in; padding: 0.2in; margin: 0.25in auto; border: 1px solid #ccc; box-shadow: 0 2px 8px rgba(0,0,0,.06); background: white; }
        .kind { font-size: 12px; font-weight: 800; text-align: center; letter-spacing: 2px; color: #555; }
        .title { font-size: 22px; font-weight: 800; text-align: center; line-height: 1.1; }
        .model { font-size: 14px; text-align: center; color: #444; margin-top: 4px; }
        .fid { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: ${type === "fixture" ? "26px" : "11px"}; font-weight: 700; text-align: center; margin-top: 8px; word-break: break-all; }
        .codes { display: flex; gap: 16px; justify-content: center; align-items: center; margin-top: 10px; }
        .loc { text-align: center; font-size: 12px; margin-top: 10px; color: #111; }
      `}</style>
      <div className="kind">{label.header}</div>
      <div className="title">{label.title}</div>
      {label.subtitle && <div className="model">{label.subtitle}</div>}
      <div className="fid">{label.code}</div>
      <div className="codes">
        <div style={{ background: "white", padding: 4 }}>
          <QRCode value={label.code} size={110} />
        </div>
        <canvas ref={canvasRef} />
      </div>
      <div className="loc">{label.loc}</div>
    </div>
  );
}
