// Lightweight sound effects via WebAudio (no asset files needed).
let ctx: AudioContext | null = null;
function ac() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.18) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function playCorrect() {
  // Cheerful rising arpeggio C5 -> E5 -> G5
  tone(523.25, 0, 0.15, "triangle", 0.2);
  tone(659.25, 0.1, 0.15, "triangle", 0.2);
  tone(783.99, 0.2, 0.25, "triangle", 0.22);
}

export function playWrong() {
  // Soft descending buzz
  tone(311.13, 0, 0.18, "sawtooth", 0.14);
  tone(207.65, 0.15, 0.28, "sawtooth", 0.14);
}