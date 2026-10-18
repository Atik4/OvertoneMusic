import { synth } from './synth';
import { detectPitch } from './pitch';
import { freqToMidi } from './music';
import { store, save } from './storage';

export type Source = 'midi' | 'mic' | 'keys' | 'screen';

export interface NoteEvt {
  midi: number;
  velocity: number;
  source: Source;
  /** performance.now() timebase, already corrected for mic delay. */
  time: number;
}

type Listener = (e: NoteEvt) => void;

// Computer keyboard: home row = white keys, row above = black keys.
const KEYMAP: Record<string, number> = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16 };

export const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['checkbox', 'range', 'radio', 'button'].includes((t as HTMLInputElement).type)));

class Input {
  private onL = new Set<Listener>();
  private offL = new Set<Listener>();
  private statusL = new Set<() => void>();
  private releases = new Map<number, () => void>();
  private keyHeld = new Map<string, number>();
  readonly held = new Map<number, Source>();

  midiDevices: string[] = [];
  midiError = '';
  micOn = false;
  micLevel = 0;
  lastSource: Source | null = null;
  keyOctave = 60;

  // mic state
  private micNote: number | null = null;
  private cand: number | null = null;
  private candCount = 0;
  private envSlow = 0;
  private pendingOnset = false;

  constructor() {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keyHeld.forEach((m, k) => (this.keyHeld.delete(k), this.noteOff(m, 'keys'))));
  }

  onNoteOn(fn: Listener) {
    this.onL.add(fn);
    return () => this.onL.delete(fn);
  }
  onNoteOff(fn: Listener) {
    this.offL.add(fn);
    return () => this.offL.delete(fn);
  }
  onStatus(fn: () => void) {
    this.statusL.add(fn);
  }
  private emitStatus() {
    this.statusL.forEach((f) => f());
  }

  noteOn(midi: number, velocity: number, source: Source, time = performance.now()) {
    if (source === 'keys' || source === 'screen') {
      this.releases.get(midi)?.();
      this.releases.set(midi, synth.note(midi, Infinity, 0, velocity));
    }
    this.held.set(midi, source);
    if (this.lastSource !== source) {
      this.lastSource = source;
      this.emitStatus();
    }
    const e: NoteEvt = { midi, velocity, source, time: source === 'mic' ? time - store.settings.micLatency : time };
    this.onL.forEach((f) => f(e));
  }

  noteOff(midi: number, source: Source) {
    this.releases.get(midi)?.();
    this.releases.delete(midi);
    if (!this.held.has(midi)) return;
    this.held.delete(midi);
    const e: NoteEvt = { midi, velocity: 0, source, time: performance.now() };
    this.offL.forEach((f) => f(e));
  }

  // ---------- computer keyboard ----------
  private onKey(e: KeyboardEvent, down: boolean) {
    if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
    const k = e.key.toLowerCase();
    if (down) {
      if (e.repeat) return;
      if (k === 'z') return void (this.keyOctave = Math.max(24, this.keyOctave - 12));
      if (k === 'x') return void (this.keyOctave = Math.min(96, this.keyOctave + 12));
      if (k in KEYMAP && !this.keyHeld.has(k)) {
        const midi = this.keyOctave + KEYMAP[k];
        this.keyHeld.set(k, midi);
        this.noteOn(midi, 0.8, 'keys');
        e.preventDefault();
      }
    } else if (this.keyHeld.has(k)) {
      this.noteOff(this.keyHeld.get(k)!, 'keys');
      this.keyHeld.delete(k);
    }
  }

  // ---------- MIDI ----------
  async enableMidi() {
    this.midiError = '';
    if (!navigator.requestMIDIAccess) {
      this.midiError = 'This browser has no Web MIDI. Use Chrome or Edge.';
      this.emitStatus();
      throw new Error(this.midiError);
    }
    try {
      const access = await navigator.requestMIDIAccess();
      const bind = () => {
        this.midiDevices = [];
        access.inputs.forEach((inp) => {
          inp.onmidimessage = (m) => this.handleMidi(m);
          this.midiDevices.push(inp.name || 'MIDI keyboard');
        });
        this.emitStatus();
      };
      access.onstatechange = bind;
      bind();
      store.settings.midiEnabled = true;
      save();
    } catch (err) {
      this.midiError = 'MIDI access was blocked.';
      this.emitStatus();
      throw err;
    }
  }

  private handleMidi(m: MIDIMessageEvent) {
    const d = m.data;
    if (!d || d.length < 3) return;
    const cmd = d[0] & 0xf0;
    if (cmd === 0x90 && d[2] > 0) this.noteOn(d[1], d[2] / 127, 'midi', m.timeStamp);
    else if (cmd === 0x80 || (cmd === 0x90 && d[2] === 0)) this.noteOff(d[1], 'midi');
  }

  // ---------- microphone ----------
  async enableMic() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const ctx = synth.audio;
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    setInterval(() => this.micTick(an, buf, ctx.sampleRate), 12);
    this.micOn = true;
    store.settings.micEnabled = true;
    save();
    this.emitStatus();
  }

  private micTick(an: AnalyserNode, buf: Float32Array<ArrayBuffer>, sr: number) {
    an.getFloatTimeDomainData(buf);
    let sq = 0;
    for (let i = 0; i < buf.length; i++) sq += buf[i] * buf[i];
    const rms = Math.sqrt(sq / buf.length);
    this.micLevel = rms;
    const gate = store.settings.micGate;

    const release = () => {
      if (this.micNote !== null) this.noteOff(this.micNote, 'mic');
      this.micNote = null;
      this.cand = null;
      this.candCount = 0;
    };

    // Don't listen to our own speakers.
    if (synth.isBusy()) {
      release();
      this.envSlow = rms;
      return;
    }
    if (rms < gate) {
      if (rms < gate * 0.7) release();
      this.envSlow = this.envSlow * 0.85 + rms * 0.15;
      return;
    }

    // A sudden jump in loudness = a new key strike (lets us catch repeated notes).
    if (rms > this.envSlow * 1.8 && rms > gate * 2) {
      this.pendingOnset = true;
      this.cand = null;
      this.candCount = 0;
    }
    this.envSlow = this.envSlow * 0.85 + rms * 0.15;

    const r = detectPitch(buf, sr);
    if (!r || r.clarity < 0.85 || r.freq < 40 || r.freq > 4300) return;
    const midi = Math.round(freqToMidi(r.freq));
    if (midi === this.cand) this.candCount++;
    else {
      this.cand = midi;
      this.candCount = 1;
    }
    if (this.candCount >= 2 && (midi !== this.micNote || this.pendingOnset)) {
      if (this.micNote !== null) this.noteOff(this.micNote, 'mic');
      this.micNote = midi;
      this.pendingOnset = false;
      // ~2 frames of 12 ms to confirm, plus analysis window; compensated by micLatency setting.
      this.noteOn(midi, Math.min(1, rms * 8), 'mic');
    }
  }
}

export const input = new Input();
