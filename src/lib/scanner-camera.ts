import { useRef, useState } from "react";
import { DecodeHintType, useZxing } from "react-zxing";

const scannerHints = new Map([[DecodeHintType.TRY_HARDER, true]]);

const scannerConstraints: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

export function useAutoStopScanner(onResult: (text: string) => void) {
  const handledRef = useRef(false);
  const [paused, setPaused] = useState(false);

  const scanner = useZxing({
    paused,
    constraints: scannerConstraints,
    hints: scannerHints,
    timeBetweenDecodingAttempts: 100,
    onDecodeResult: (result) => {
      if (handledRef.current) return;
      handledRef.current = true;
      setPaused(true);
      stopVideoTracks(scanner.ref.current);
      onResult(result.getText());
    },
  });

  return scanner;
}

function stopVideoTracks(video: HTMLVideoElement | null) {
  const stream = video?.srcObject;
  if (!(stream instanceof MediaStream)) return;
  stream.getTracks().forEach((track) => track.stop());
}
