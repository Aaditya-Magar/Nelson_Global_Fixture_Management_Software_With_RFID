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
  const id = params.get("id") ?? "";
  const [fx, setFx] = useState<FixtureWithLocation | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!id) return;
    supabase.from("fixtures").select(FIXTURE_LOCATION_SELECT).eq("id", id).maybeSingle().then(({ data }) => {
      setFx((data as unknown as FixtureWithLocation) ?? null);
    });
  }, [id]);

  useEffect(() => {
    if (!fx || !canvasRef.current) return;
    try {
      bwipjs.toCanvas(canvasRef.current, { bcid: "code128", text: fx.fixture_id, scale: 3, height: 14, includetext: true, textxalign: "center" });
    } catch { /* noop */ }
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [fx]);

  if (!fx) return <div className="p-6 text-sm">Loading…</div>;
  const path = locationPathText(fx);

  return (
    <div className="label-page">
      <style>{`
        @page { size: 4in 3in; margin: 0.25in; }
        @media print { body { margin: 0 } .label-page { box-shadow: none !important; border: none !important; } }
        body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: white; }
        .label-page { width: 4in; padding: 0.2in; margin: 0.25in auto; border: 1px solid #ccc; box-shadow: 0 2px 8px rgba(0,0,0,.06); background: white; }
        .title { font-size: 22px; font-weight: 800; text-align: center; line-height: 1.1; }
        .model { font-size: 14px; text-align: center; color: #444; margin-top: 4px; }
        .fid { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 26px; font-weight: 700; text-align: center; margin-top: 8px; letter-spacing: 1px; }
        .codes { display: flex; gap: 16px; justify-content: center; align-items: center; margin-top: 10px; }
        .loc { text-align: center; font-size: 12px; margin-top: 10px; color: #111; }
      `}</style>
      <div className="title">{fx.name}</div>
      {fx.model_number && <div className="model">Model: {fx.model_number}</div>}
      <div className="fid">{fx.fixture_id}</div>
      <div className="codes">
        <div style={{ background: "white", padding: 4 }}>
          <QRCode value={fx.fixture_id} size={110} />
        </div>
        <canvas ref={canvasRef} />
      </div>
      <div className="loc">📍 {path ?? "Location not assigned"}</div>
    </div>
  );
}
