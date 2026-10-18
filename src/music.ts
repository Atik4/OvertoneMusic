export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const pc = (midi: number) => ((midi % 12) + 12) % 12;
export const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(pc(midi));
export const midiToName = (midi: number) => NOTE_NAMES[pc(midi)] + (Math.floor(midi / 12) - 1);
export const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
export const freqToMidi = (freq: number) => 69 + 12 * Math.log2(freq / 440);

/** "C4", "F#3", "Bb5" -> MIDI number (C4 = 60). */
export function nameToMidi(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`Bad note name: ${name}`);
  const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (parseInt(m[3]) + 1) * 12 + STEP_PC[m[1]] + alter;
}

/** Staff position: counts letter names only (C4 = 28, D4 = 29, …), ignoring sharps/flats. */
export function diatonic(name: string): number {
  const m = /^([A-G])[#b]?(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`Bad note name: ${name}`);
  return parseInt(m[2]) * 7 + 'CDEFGAB'.indexOf(m[1]);
}

export const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function weightedPick<T>(items: readonly T[], weight: (item: T) => number): T {
  const ws = items.map(weight);
  let r = Math.random() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
