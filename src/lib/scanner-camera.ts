import { useEffect, useRef } from "react";
import { BarcodeFormat, BrowserMultiFormatReader, DecodeHintType } from "@zxing/library";

type NativeBarcode = { rawValue?: string };
type NativeBarcodeDetector = { detect: (source: HTMLVideoElement) => Promise<NativeBarcode[]> };
type NativeBarcodeDetectorCtor = new (options?: { formats?: string[] }) => NativeBarcodeDetector;

declare global {
  interface Window {
    BarcodeDetector?: NativeBarcodeDetectorCtor & {
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
}

const supportedFormats = [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.CODE_128,
];

const scannerHints = new Map<DecodeHintType, unknown>([
  [DecodeHintType.TRY_HARDER, true],
  [DecodeHintType.POSSIBLE_FORMATS, supportedFormats],
]);

const nativeFormats = [
  "qr_code",
  "code_128",
];

const scanIntervalMs = 40;

const scannerConstraints: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

export function useAutoStopScanner(onResult: (text: string) => void) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;
    let nativeTimer: number | null = null;
    const reader = new BrowserMultiFormatReader(scannerHints, scanIntervalMs);

    const stop = () => {
      active = false;
      if (nativeTimer !== null) window.clearTimeout(nativeTimer);
      reader.reset();
      stopVideoTracks(ref.current);
      stream?.getTracks().forEach((track) => track.stop());
    };

    const handleResult = (text: string) => {
      if (handledRef.current) return;
      const value = text.trim();
      if (!value) return;
      handledRef.current = true;
      stop();
      onResult(value);
    };

    const start = async () => {
      const video = ref.current;
      if (!video) return;

      stream = await navigator.mediaDevices.getUserMedia(scannerConstraints);
      if (!active) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      video.srcObject = stream;
      await video.play().catch(() => undefined);

      startNativeDetector(video, handleResult, () => active, (timer) => {
        nativeTimer = timer;
      });

      reader.decodeFromStream(stream, video, (result) => {
        if (result) handleResult(result.getText());
      }).catch(() => undefined);
    };

    start().catch(() => undefined);

    return stop;
  }, [onResult]);

  return { ref };
}

function stopVideoTracks(video: HTMLVideoElement | null) {
  if (!video) return;
  const stream = video.srcObject;
  if (!(stream instanceof MediaStream)) return;
  stream.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
}

function startNativeDetector(
  video: HTMLVideoElement,
  onResult: (text: string) => void,
  isActive: () => boolean,
  setTimer: (timer: number) => void,
) {
  const Detector = window.BarcodeDetector;
  if (!Detector) return;

  let detector: NativeBarcodeDetector;
  try {
    detector = new Detector({ formats: nativeFormats });
  } catch {
    try {
      detector = new Detector();
    } catch {
      return;
    }
  }

  const detect = async () => {
    if (!isActive()) return;
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const codes = await detector.detect(video).catch(() => []);
      const value = codes.find((code) => code.rawValue)?.rawValue;
      if (value) {
        onResult(value);
        return;
      }
    }
    setTimer(window.setTimeout(detect, scanIntervalMs));
  };

  detect();
}
