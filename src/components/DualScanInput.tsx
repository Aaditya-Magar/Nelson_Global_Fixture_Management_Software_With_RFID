import { useEffect, useState } from "react";
import { Camera, CheckCircle2, Keyboard, Radio, XCircle } from "lucide-react";
import { ScannerButton } from "@/components/ScannerButton";
import { cleanNFCTagId, useNFCScan } from "@/hooks/useNFCScan";
import { sanitizeText } from "@/lib/sanitize";

type ScanMode = "idle" | "camera" | "nfc";
type ScanStatus = "idle" | "scanning" | "success" | "error";

interface DualScanInputProps {
  label: string;
  instruction: string;
  active: boolean;
  onScanResult: (scannedId: string) => void;
  successMessage?: string;
  errorMessage?: string;
  status: ScanStatus;
  disabled?: boolean;
}

export function DualScanInput({
  label,
  instruction,
  active,
  onScanResult,
  successMessage,
  errorMessage,
  status,
  disabled,
}: DualScanInputProps) {
  const [mode, setMode] = useState<ScanMode>("idle");
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [nfcError, setNfcError] = useState<string | null>(null);

  const handleValue = (raw: string) => {
    const value = cleanNFCTagId(sanitizeText(raw, 120).trim());
    if (!value) return;
    setMode("idle");
    onScanResult(value);
  };

  const { isScanning, isSupported, stopScanning } = useNFCScan({
    active: active && mode === "nfc" && !disabled,
    onScan: (result) => {
      stopScanning();
      handleValue(result.tagId);
    },
    onError: (message) => setNfcError(message),
  });

  useEffect(() => {
    if (!active || disabled) {
      stopScanning();
      setMode("idle");
    }
  }, [active, disabled, stopScanning]);

  const submitManual = () => {
    handleValue(manual);
    setManual("");
  };

  const nfcActive = mode === "nfc" && isScanning;

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="font-semibold text-sm">{label}</div>
      <div className="mt-1 text-xs text-muted-foreground">{instruction}</div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <ScannerButton
          onResult={handleValue}
          className={`min-h-20 rounded-md border px-3 py-3 text-sm font-medium flex flex-col items-center justify-center gap-1 ${
            disabled || !active
              ? "pointer-events-none opacity-50 cursor-not-allowed border-border bg-card text-muted-foreground"
              : "border-border bg-card hover:bg-secondary/60"
          }`}
        >
          <Camera className="h-5 w-5" />
          Camera Scan
        </ScannerButton>
        <button
          type="button"
          disabled={disabled || !active || !isSupported}
          title={isSupported ? "Tap NFC tag" : "Requires Android Chrome"}
          onClick={() => {
            setNfcError(null);
            setMode("nfc");
          }}
          className={`min-h-20 rounded-md border px-3 py-3 text-sm font-medium flex flex-col items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed ${
            nfcActive ? "border-green-500 bg-green-50 text-green-800 animate-pulse" : "border-border bg-card hover:bg-secondary/60"
          }`}
        >
          <Radio className="h-5 w-5" />
          {nfcActive ? "Hold phone near tag..." : "NFC Tap"}
        </button>
      </div>

      <div className="mt-3">
        {mode === "nfc" && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
            Waiting for NFC tap...
          </div>
        )}
        {status === "success" && successMessage && (
          <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {successMessage}
          </div>
        )}
        {status === "error" && (errorMessage || nfcError) && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 flex items-start gap-2">
            <XCircle className="h-4 w-4 mt-0.5 shrink-0" /> {errorMessage || nfcError}
          </div>
        )}
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          className="w-full text-[11px] text-muted-foreground flex items-center justify-center gap-2"
        >
          <span className="h-px flex-1 bg-border" />
          <Keyboard className="h-3.5 w-3.5" />
          or enter ID manually
          <span className="h-px flex-1 bg-border" />
        </button>
        {manualOpen && (
          <div className="mt-2 flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitManual();
                }
              }}
              disabled={disabled || !active}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Enter QR, barcode, or NFC ID"
              maxLength={120}
            />
            <button type="button" onClick={submitManual} disabled={disabled || !active} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">
              Submit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
