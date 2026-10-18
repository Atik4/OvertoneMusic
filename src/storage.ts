import type { LeftHand } from './simplify';
export type Hands = 'right' | 'left' | 'both';

export interface PieceProgress {
  tempoPct: number;
  hands: Hands;
  /** "hands@tempoPct" -> best accuracy (0..1) */
  best: Record<string, number>;
  /** Semitones up (+) or down (-) from the written key. */
  transpose?: number;
  /** Easier left hand: 'written' | 'chords' | 'bass'. */
  leftHand?: LeftHand;
}

export interface NoteStat {
  ok: number;
  bad: number;
  ms: number;
}

export interface Settings {
  kbdRange: string;
  showNames: boolean;
  volume: number;
  micGate: number;
  micLatency: number;
  midiEnabled: boolean;
  micEnabled: boolean;
  practiceShow: 'all' | 'bar' | 'note';
  showKbd: boolean;
}

interface Data {
  settings: Settings;
  pieces: Record<string, PieceProgress>;
  reading: { notes: Record<string, NoteStat>; bestChallenge: number; streamNpm: number; bestStreamNpm: number; bestWaitNpm: number };
  ear: Record<string, { ok: number; n: number }>;
  /** YYYY-MM-DD -> active practice minutes */
  days: Record<string, number>;
  uploads: { id: string; title: string }[];
}

const KEY = 'pianoCoach.v1';

const defaults: Data = {
  settings: { kbdRange: '36-96', showNames: false, volume: 0.7, micGate: 0.01, micLatency: 70, midiEnabled: false, micEnabled: false, practiceShow: 'all', showKbd: true },
  pieces: {},
  reading: { notes: {}, bestChallenge: 0, streamNpm: 30, bestStreamNpm: 0, bestWaitNpm: 0 },
  ear: {},
  days: {},
  uploads: [],
};

function load(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<Data>;
      return {
        ...structuredClone(defaults),
        ...d,
        settings: { ...defaults.settings, ...d.settings },
        reading: { ...defaults.reading, ...d.reading },
      };
    }
  } catch {
    /* corrupted storage: start fresh */
  }
  return structuredClone(defaults);
}

export const store: Data = load();

let timer: number | undefined;
export function save() {
  clearTimeout(timer);
  timer = window.setTimeout(() => localStorage.setItem(KEY, JSON.stringify(store)), 300);
}

export function resetProgress() {
  store.pieces = {};
  store.reading = structuredClone(defaults.reading);
  store.ear = {};
  store.days = {};
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function pieceProgress(id: string): PieceProgress {
  return (store.pieces[id] ??= { tempoPct: 70, hands: 'right', best: {} });
}

const ymd = (d: Date) => d.toLocaleDateString('en-CA');

let lastMinute = -1;
/** Call on every played note; counts distinct active minutes per day. */
export function recordActivity() {
  const m = Math.floor(Date.now() / 60000);
  if (m === lastMinute) return;
  lastMinute = m;
  const today = ymd(new Date());
  store.days[today] = (store.days[today] ?? 0) + 1;
  save();
}

export function streakInfo() {
  const d = new Date();
  if (!store.days[ymd(d)]) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (store.days[ymd(d)]) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return { streak, minutesToday: store.days[ymd(new Date())] ?? 0 };
}

export function saveUpload(title: string, data: string): { id: string; saved: boolean } {
  const id = 'up:' + Date.now().toString(36);
  try {
    localStorage.setItem('pianoCoach.' + id, data);
    store.uploads.push({ id, title });
    save();
    return { id, saved: true };
  } catch {
    return { id, saved: false };
  }
}

export function loadUpload(id: string): string | null {
  return localStorage.getItem('pianoCoach.' + id);
}

export function deleteUpload(id: string) {
  localStorage.removeItem('pianoCoach.' + id);
  store.uploads = store.uploads.filter((u) => u.id !== id);
  delete store.pieces[id];
  save();
}
