import { useEffect, useState, type ReactNode } from "react";
import { X, Camera } from "lucide-react";
import { useAutoStopScanner } from "@/lib/scanner-camera";

export function ScannerButton({
  onResult,
  className,
  children,
}: {
  onResult: (text: string) => void;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "rounded-md bg-primary text-primary-foreground p-2.5 hover:bg-primary/90"}
        aria-label="Scan barcode or QR"
      >
        {children ?? <Camera className="h-5 w-5" />}
      </button>
      {open && <ScannerModal onClose={() => setOpen(false)} onResult={(t) => { setOpen(false); onResult(t); }} />}
    </>
  );
}

function ScannerModal({ onClose, onResult }: { onClose: () => void; onResult: (text: string) => void }) {
  const { ref } = useAutoStopScanner(onResult);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
      <div className="text-center text-white/80 text-sm pb-6">Point camera at a barcode or QR code</div>
    </div>
  );
}
