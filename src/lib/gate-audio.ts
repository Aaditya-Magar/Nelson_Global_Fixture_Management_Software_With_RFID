// Web Audio API tone generators for gate scan feedback.
let ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try { ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); }
    catch { return null; }
  }
  return ctx;
}

export function playSuccessBeep() {
  const c = getCtx(); if (!c) return;
  [600, 800].forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination);
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.3, c.currentTime + i * 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + i * 0.15 + 0.1);
    osc.start(c.currentTime + i * 0.15);
    osc.stop(c.currentTime + i * 0.15 + 0.1);
  });
}

export function playGateOpenSound() {
  const c = getCtx(); if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain); gain.connect(c.destination);
  osc.frequency.value = 1000;
  osc.type = "sine";
  gain.gain.setValueAtTime(0.4, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.8);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.8);
}

export function playErrorSound() {
  const c = getCtx(); if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain); gain.connect(c.destination);
  osc.type = "square";
  osc.frequency.setValueAtTime(400, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(150, c.currentTime + 0.4);
  gain.gain.setValueAtTime(0.3, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.4);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.4);
}
