import { midiToFreq } from './music';

interface NoteOpts {
  /** Count this note as "app is making sound" so the mic ignores it. Default true. */
  track?: boolean;
}

// Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0. One sample every 3 semitones (C, D#, F#, A).
const SAMPLE_NOTES: [string, number][] = [];
for (let oct = 0; oct <= 8; oct++) {
  for (const [name, off] of [['C', 0], ['Ds', 3], ['Fs', 6], ['A', 9]] as const) {
    const midi = (oct + 1) * 12 + off;
    if (midi >= 21 && midi <= 108) SAMPLE_NOTES.push([`${name}${oct}`, midi]);
  }
}

/** Piano sound: recorded grand piano samples, with a small additive synth as fallback while they load. */
class Synth {
  private ctx?: AudioContext;
  private samples = new Map<number, AudioBuffer>();
  private master!: GainNode;
  private bus!: GainNode;
  private busyUntil = 0;
  private heldCount = 0;
  private volume = 0.7;

  get audio(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      const comp = this.ctx.createDynamicsCompressor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(comp).connect(this.ctx.destination);
      this.bus = this.ctx.createGain();
      this.bus.connect(this.master);
      this.loadSamples(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private loadSamples(ctx: AudioContext) {
    for (const [file, midi] of SAMPLE_NOTES) {
      fetch(`${import.meta.env.BASE_URL}piano/${file}.mp3`)
        .then((r) => r.arrayBuffer())
        .then((b) => ctx.decodeAudioData(b))
        .then((buf) => this.samples.set(midi, buf))
        .catch(() => {
          /* keep using the synth for this range */
        });
    }
  }

  private nearestSample(midi: number): [number, AudioBuffer] | null {
    let best: [number, AudioBuffer] | null = null;
    for (const [m, buf] of this.samples) if (!best || Math.abs(m - midi) < Math.abs(best[0] - midi)) best = [m, buf];
    return best && Math.abs(best[0] - midi) <= 3 ? best : null;
  }

  get running() {
    return this.ctx?.state === 'running';
  }

  now() {
    return this.audio.currentTime;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  /** True while the app itself is producing note sound (used to mute mic detection). */
  isBusy() {
    if (!this.ctx) return false;
    return this.heldCount > 0 || this.ctx.currentTime < this.busyUntil;
  }

  /** Stop everything scheduled so far (e.g. when a playback is stopped). */
  stopAll() {
    if (!this.ctx) return;
    const old = this.bus;
    old.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    setTimeout(() => old.disconnect(), 400);
    this.bus = this.ctx.createGain();
    this.bus.connect(this.master);
    this.busyUntil = 0;
  }

  /**
   * Play a note. `dur` = Infinity means "held until release()".
   * Returns a release function.
   */
  note(midi: number, dur: number, when = 0, velocity = 0.8, opts: NoteOpts = {}): () => void {
    const ctx = this.audio;
    const track = opts.track ?? true;
    const t = ctx.currentTime + Math.max(0, when);
    const sample = this.nearestSample(midi);
    if (sample) return this.sampledNote(sample, midi, dur, t, velocity, track);
    const f = midiToFreq(midi);

    const out = ctx.createGain();
    out.gain.value = 0.16 * (0.4 + 0.6 * velocity);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(14000, f * 6 + 1500 * velocity);
    out.connect(lp).connect(this.bus);

    const ring = Math.max(0.7, 4.5 - (midi - 40) * 0.06);
    const partials: [number, number][] = [[1, 1], [2, 0.5], [3, 0.25], [4, 0.14], [5, 0.07], [6, 0.05], [7, 0.03]];
    const oscs: OscillatorNode[] = [];
    for (const [k, amp] of partials) {
      const pf = f * k * Math.sqrt(1 + 0.0004 * k * k);
      if (pf > 15000) continue;
      const o = ctx.createOscillator();
      o.frequency.value = pf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.004);
      g.gain.setTargetAtTime(0, t + 0.004, ring / (4 * (1 + (k - 1) * 0.6)));
      o.connect(g).connect(out);
      o.start(t);
      oscs.push(o);
    }

    const release = (at: number) => {
      out.gain.cancelScheduledValues(at);
      out.gain.setTargetAtTime(0, at, 0.07);
      for (const o of oscs) o.stop(at + 0.6);
    };

    if (Number.isFinite(dur)) {
      release(t + dur);
      if (track) this.busyUntil = Math.max(this.busyUntil, t + dur + 0.25);
      return () => release(ctx.currentTime);
    }

    if (track) this.heldCount++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (track) {
        this.heldCount--;
        this.busyUntil = Math.max(this.busyUntil, ctx.currentTime + 0.25);
      }
      release(ctx.currentTime);
    };
  }

  private sampledNote([base, buf]: [number, AudioBuffer], midi: number, dur: number, t: number, velocity: number, track: boolean): () => void {
    const ctx = this.audio;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, (midi - base) / 12);
    // One loud velocity layer: soften quieter notes with gain and a gentle low-pass.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800 + 16000 * velocity * velocity;
    const g = ctx.createGain();
    g.gain.value = 0.25 + 0.6 * velocity;
    src.connect(lp).connect(g).connect(this.bus);
    src.start(t);

    const release = (at: number) => {
      g.gain.cancelScheduledValues(at);
      g.gain.setTargetAtTime(0, at, 0.1);
      src.stop(at + 1);
    };
    if (Number.isFinite(dur)) {
      release(t + dur);
      if (track) this.busyUntil = Math.max(this.busyUntil, t + dur + 0.35);
      return () => release(ctx.currentTime);
    }
    if (track) this.heldCount++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (track) {
        this.heldCount--;
        this.busyUntil = Math.max(this.busyUntil, ctx.currentTime + 0.35);
      }
      release(ctx.currentTime);
    };
  }

  chord(midis: number[], dur: number, when = 0, velocity = 0.7) {
    for (const m of midis) this.note(m, dur, when, velocity);
  }

  click(when = 0, accent = false) {
    const ctx = this.audio;
    const t = ctx.currentTime + Math.max(0, when);
    const o = ctx.createOscillator();
    o.frequency.value = accent ? 1760 : 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.45 : 0.25, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.06);
  }
}

export const synth = new Synth();
