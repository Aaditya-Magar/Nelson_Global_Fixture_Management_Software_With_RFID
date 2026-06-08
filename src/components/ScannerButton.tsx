import { useEffect, useRef, useState } from "react";
import { useZxing } from "react-zxing";
import { X, Camera } from "lucide-react";

export function ScannerButton({ onResult }: { onResult: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-primary text-primary-foreground p-2.5 hover:bg-primary/90"
        aria-label="Scan barcode or QR"
      >
        <Camera className="h-5 w-5" />
      </button>
      {open && <ScannerModal onClose={() => setOpen(false)} onResult={(t) => { setOpen(false); onResult(t); }} />}
    </>
  );
}

function ScannerModal({ onClose, onResult }: { onClose: () => void; onResult: (text: string) => void }) {
  const handledRef = useRef(false);
  const { ref } = useZxing({
    onDecodeResult: (r) => {
      if (handledRef.current) return;
      handledRef.current = true;
      onResult(r.getText());
    },
    paused: false,
  });

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
      <video ref={ref} className="flex-1 w-full object-cover" />
      <div className="text-center text-white/80 text-sm pb-6">Point camera at a barcode or QR code</div>
    </div>
  );
}
