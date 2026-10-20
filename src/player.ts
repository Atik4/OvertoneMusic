import { synth } from './synth';
import { store } from './storage';

/**
 * Score player (like MuseScore's): play/pause, seek by bar, live tempo, loop, hands, metronome,
 * with the score cursor following along. Time is tracked in quarter notes so tempo can change mid-play.
 */

export interface SNote { midi: number; staff: number; durQ: number }
/** A note's head on the sheet, for writing its letter name in it or colouring it after a run. */
export interface NoteHead { midi: number; staff: number; name: string; hollow: boolean; group: SVGGElement; el: SVGGraphicsElement | null }
export interface Step { idx: number; timeQ: number; measure: number; notes: SNote[]; els: SVGGElement[]; heads: NoteHead[] }

/** Which beat of its bar (0 = the downbeat) time `q` falls on, going by the bar the music is in at that moment. */
export function beatInBar(steps: Step[], q: number, beatQ: number): number {
  let i = 0;
  while (i + 1 < steps.length && steps[i + 1].timeQ <= q + 1e-6) i++;
  let first = i;
  while (first > 0 && steps[first - 1].measure === steps[i].measure) first--;
  const barStart = steps[first]?.timeQ ?? 0;
  return Math.max(0, Math.round((q - barStart) / beatQ));
}

export interface PlayerHost {
  steps(): Step[];
  measureCount(): number;
  /** Quarter notes per second at the current speed setting. */
  qps(): number;
  beatQ(): number;
  beatsPerBar(): number;
  staffCount(): number;
  /** Bars (0-based, inclusive) chosen in the "Bars" fields. */
  barRange(): [number, number];
  /** Called when playback moves to another step, to move the cursor. */
  onStep(idx: number): void;
  /** Called when playback starts, so the practice run can stop. */
  onPlay(): void;
}

let root: HTMLElement;
let host: PlayerHost;
let measureStart: number[] = [];
let endQ = 0;

let playing = false;
let posQ = 0;
let anchorQ = 0;
let anchorCtx = 0;
let lastQps = 1;
let schedIdx = 0;
let nextBeatQ = 0;
let playFromQ = 0;
let curStep = -1;
let raf = 0;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
const checked = (id: string) => $<HTMLInputElement>(id).checked;
const hear = () => $<HTMLSelectElement>('pl-hands').value as 'both' | 'right' | 'left';

export function init(el: HTMLElement, h: PlayerHost) {
  root = el;
  host = h;
  el.innerHTML = `
    <div class="row">
      <button id="pl-start" title="Back to start">⏮</button>
      <button class="primary" id="pl-play">▶ Play</button>
      <button id="pl-stop" title="Stop">⏹</button>
      <label class="field grow">Position <span class="row tight"><input type="range" id="pl-seek" min="1" max="1" step="1" value="1"><b id="pl-pos">Bar 1</b></span></label>
      <label class="field">Hear <select id="pl-hands"><option value="both">Both hands</option><option value="right">Right hand only</option><option value="left">Left hand only</option></select></label>
      <label class="check"><input type="checkbox" id="pl-loop"> Loop bars</label>
      <label class="check"><input type="checkbox" id="pl-metro"> Metronome</label>
      <label class="check"><input type="checkbox" id="pl-countin"> Count-in</label>
    </div>
    <p class="muted small">Listen first, then play it back yourself. The Speed slider sets the tempo, even while playing. Loop plays the bars chosen in “Bars”. Click any note on the sheet to play or practise from there.</p>`;

  $('pl-play').onclick = () => (playing ? pause() : play());
  $('pl-stop').onclick = () => stop();
  $('pl-start').onclick = () => seek(startQ());
  $<HTMLInputElement>('pl-seek').oninput = (e) => seek(measureStart[Number((e.target as HTMLInputElement).value) - 1] ?? 0);
  $('pl-hands').addEventListener('change', () => playing && seek(posQ));
  $('pl-loop').addEventListener('change', () => !playing && seek(startQ()));
  root.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => b.blur()));
}

/** Call after a new piece is loaded. */
export function load() {
  stop(true);
  const steps = host.steps();
  measureStart = [];
  for (const s of steps) if (measureStart[s.measure] === undefined) measureStart[s.measure] = s.timeQ;
  endQ = Math.max(0, ...steps.map((s) => s.timeQ + Math.max(0, ...s.notes.map((n) => n.durQ))));
  const seekEl = $<HTMLInputElement>('pl-seek');
  seekEl.max = String(host.measureCount());
  posQ = 0;
  curStep = -1;
  showPosition();
  $('pl-hands').toggleAttribute('disabled', host.staffCount() < 2);
}

export const isPlaying = () => playing;

const startQ = () => (checked('pl-loop') ? measureStart[host.barRange()[0]] ?? 0 : 0);
const stopQ = () => {
  if (!checked('pl-loop')) return endQ;
  const next = measureStart[host.barRange()[1] + 1];
  return next ?? endQ;
};

function audible(staff: number) {
  if (host.staffCount() < 2) return true;
  const h = hear();
  return h === 'both' || (h === 'right' ? staff === 0 : staff === 1);
}

export function play() {
  host.onPlay();
  if (posQ >= stopQ() - 1e-6 || posQ < startQ() - 1e-6) posQ = startQ();
  playFromQ = posQ;
  // Count-in: start one bar early with clicks only.
  if (checked('pl-countin')) posQ -= host.beatsPerBar() * host.beatQ();
  playing = true;
  lastQps = host.qps();
  anchor();
  resetSchedule();
  $('pl-play').textContent = '⏸ Pause';
  raf = requestAnimationFrame(tick);
}

export function pause() {
  if (!playing) return;
  playing = false;
  cancelAnimationFrame(raf);
  synth.stopAll();
  posQ = Math.max(posQ, playFromQ);
  $('pl-play').textContent = '▶ Play';
}

export function stop(silent = false) {
  pause();
  posQ = startQ();
  curStep = -1;
  if (!silent) {
    jumpCursor();
    showPosition();
  }
}

/** Move the play position to a step (e.g. a note clicked on the sheet); keeps playing if it was. */
export function seekToStep(idx: number) {
  const step = host.steps()[idx];
  if (step) seek(step.timeQ);
}

function seek(q: number) {
  posQ = q;
  playFromQ = q;
  if (playing) {
    synth.stopAll();
    anchor();
  }
  resetSchedule();
  jumpCursor();
  showPosition();
}

function anchor() {
  anchorQ = posQ;
  anchorCtx = synth.now();
}

function resetSchedule() {
  const steps = host.steps();
  schedIdx = steps.findIndex((s) => s.timeQ >= Math.max(posQ, playFromQ) - 1e-6);
  if (schedIdx < 0) schedIdx = steps.length;
  const bq = host.beatQ();
  nextBeatQ = Math.ceil((posQ - 1e-6) / bq) * bq;
}

function jumpCursor() {
  const steps = host.steps();
  let idx = 0;
  for (let i = 0; i < steps.length && steps[i].timeQ <= Math.max(0, posQ) + 1e-3; i++) idx = i;
  if (idx !== curStep) {
    curStep = idx;
    host.onStep(idx);
  }
}

function tick() {
  if (!playing) return;
  const qps = host.qps();
  const now = synth.now();
  posQ = anchorQ + (now - anchorCtx) * lastQps;
  if (qps !== lastQps) {
    // Speed slider moved: keep going from here at the new tempo.
    lastQps = qps;
    anchor();
  }

  if (posQ >= stopQ()) {
    if (checked('pl-loop')) {
      posQ = startQ();
      playFromQ = posQ;
      anchor();
      resetSchedule();
    } else {
      stop();
      return;
    }
  }

  const horizon = posQ + 0.3 * qps;
  const steps = host.steps();
  const limit = stopQ();
  while (schedIdx < steps.length && steps[schedIdx].timeQ < horizon && steps[schedIdx].timeQ < limit) {
    const s = steps[schedIdx++];
    const when = (s.timeQ - posQ) / qps;
    const downbeat = s.timeQ === measureStart[s.measure];
    for (const n of s.notes) {
      if (!audible(n.staff)) continue;
      // Melody a little louder than accompaniment, bar starts slightly accented.
      const vel = (n.staff === 0 ? 0.7 : 0.55) + (downbeat ? 0.08 : 0);
      synth.note(n.midi, Math.max(0.12, (n.durQ / qps) * 0.97), when, vel);
    }
  }
  const bq = host.beatQ();
  while (nextBeatQ < horizon && nextBeatQ < limit) {
    const countIn = nextBeatQ < playFromQ - 1e-6;
    if (checked('pl-metro') || countIn) {
      // The count-in counts its own bar ("one, two, three, four"), then the music's bars take over.
      const beat = countIn ? Math.round((nextBeatQ - playFromQ) / bq) + host.beatsPerBar() : beatInBar(steps, nextBeatQ, bq);
      synth.metronome((nextBeatQ - posQ) / qps, beat, bq / qps, store.settings.counting);
    }
    nextBeatQ += bq;
  }

  if (posQ >= playFromQ - 1e-6) jumpCursor();
  showPosition();
  raf = requestAnimationFrame(tick);
}

function showPosition() {
  const q = Math.max(0, posQ);
  let bar = 0;
  while (bar + 1 < measureStart.length && measureStart[bar + 1] <= q + 1e-6) bar++;
  const qps = host.qps();
  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  $<HTMLInputElement>('pl-seek').value = String(bar + 1);
  $('pl-pos').textContent = `Bar ${bar + 1}/${host.measureCount()} · ${fmt(q / qps)} / ${fmt(endQ / qps)}`;
}
