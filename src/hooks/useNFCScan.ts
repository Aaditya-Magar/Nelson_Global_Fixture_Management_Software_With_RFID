import { useCallback, useEffect, useRef, useState } from "react";

export interface NFCScanResult {
  tagId: string;
  timestamp: Date;
}

interface UseNFCScanOptions {
  onScan: (result: NFCScanResult) => void;
  onError?: (error: string) => void;
  active: boolean;
}

export function cleanNFCTagId(raw: string): string {
  return raw.replace(/:/g, "").toUpperCase();
}

export function checkNFCSupport(): { supported: boolean; reason?: string } {
  if (typeof window === "undefined" || !("NDEFReader" in window)) {
    return {
      supported: false,
      reason: "NFC requires Android Chrome browser. Camera scanning is still available.",
    };
  }
  return { supported: true };
}

export function useNFCScan({ onScan, onError, active }: UseNFCScanOptions) {
  const [isScanning, setIsScanning] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const readerRef = useRef<any>(null);

  useEffect(() => {
    setIsSupported(checkNFCSupport().supported);
  }, []);

  const stopScanning = useCallback(() => {
    setIsScanning(false);
    readerRef.current = null;
  }, []);

  const startScanning = useCallback(async () => {
    if (!isSupported) {
      onError?.("NFC is not supported. Please use Android Chrome.");
      return;
    }
    try {
      const reader = new (window as any).NDEFReader();
      readerRef.current = reader;
      await reader.scan();
      setIsScanning(true);

      reader.addEventListener("reading", ({ serialNumber }: any) => {
        const cleanId = cleanNFCTagId(serialNumber);
        onScan({ tagId: cleanId, timestamp: new Date() });
      });

      reader.addEventListener("readingerror", () => {
        onError?.("Could not read NFC tag. Please try again.");
      });
    } catch (error: any) {
      setIsScanning(false);
      if (error.name === "NotAllowedError") {
        onError?.("NFC permission denied. Please allow NFC access in Chrome settings.");
      } else if (error.name === "NotSupportedError") {
        onError?.("NFC is not available on this device.");
      } else {
        onError?.(`NFC error: ${error.message}`);
      }
    }
  }, [isSupported, onScan, onError]);

  useEffect(() => {
    if (active && isSupported) startScanning();
    return () => stopScanning();
  }, [active, isSupported, startScanning, stopScanning]);

  return { isScanning, isSupported, startScanning, stopScanning };
}
