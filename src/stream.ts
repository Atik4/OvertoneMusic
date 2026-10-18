import { synth } from './synth';
import { kbd } from './keyboard';
import type { NoteEvt } from './input';
import { store, save } from './storage';
import { clamp, diatonic, midiToName } from './music';

/**
 * "Note stream": an endless line of random notes scrolling toward a play line,
 * so you have to read every note instead of remembering a tune.
 */

export type Clef = 'treble' | 'bass';
export interface StreamNote { name: string; midi: number; clef: Clef }
export type Movement = 'step' | 'leap';

export interface StreamDeps {
  next(prev: StreamNote | null, movement: Movement): StreamNote;
  matches(midi: number, n: StreamNote): boolean;
  record(n: StreamNote, firstTry: boolean, ms: number): void;
  clefs(): Clef[];
  showHint(): boolean;
}

interface Item extends StreamNote {
  /** Position in the stream: 0, 1, 2, … */
  n: number;
  state: 'pending' | 'ok' | 'miss';
  wrong: number;
  since: number;
  flashUntil: number;
}

const S = 14; // gap between staff lines (px)
const SPACING = 74; // px between notes
const PLAY_X = 150; // the "play now" line
const MARGIN = 50; // room above/below for ledger lines
const BOTTOM: Record<Clef, number> = { treble: diatonic('E4'), bass: diatonic('G2') }; // bottom staff line
const BLOCK = 16; // notes per speed-trainer check

let root: HTMLElement;
let deps: StreamDeps;
let svg: SVGSVGElement;
let notesG: SVGGElement;
let width = 900;
let height = 200;
let staffTop: Partial<Record<Clef, number>> = {};

let items: Item[] = [];
let p = 0; // current stream position (fractional, in notes)
let running = false;
let raf = 0;
let lastTs = 0;
let lastCur: Item | null = null;
let stats = { ok: 0, judged: 0, misses: 0, streak: 0, best: 0, okTimes: [] as number[], start: 0 };
let block = { n: 0, ok: 0 };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
const val = (id: string) => $<HTMLSelectElement>(id).value;
const checked = (id: string) => $<HTMLInputElement>(id).checked;
const flow = () => val('st-pace') === 'flow';
const npm = () => Number($<HTMLInputElement>('st-speed').value);
const rate = () => npm() / 60; // notes per second
const ahead = () => Number(val('st-ahead'));

export function init(el: HTMLElement, d: StreamDeps) {
  root = el;
  deps = d;
  el.innerHTML = `
    <div class="row">
      <label class="field">Pace
        <select id="st-pace"><option value="wait">Wait for me</option><option value="flow">Keep moving</option></select></label>
      <label class="field">Look ahead
        <select id="st-ahead"><option value="1">1 note — pure reading</option><option value="3">3 notes</option><option value="6" selected>6 notes</option><option value="10">10 notes</option></select></label>
      <label class="field">Movement
        <select id="st-move"><option value="step">Steps &amp; small skips (like real music)</option><option value="leap">Random jumps</option></select></label>
      <label class="check"><input type="checkbox" id="st-names"> Show letter names</label>
    </div>
    <div class="row" id="st-flow-opts">
      <label class="field grow">Speed <span class="row tight"><input type="range" id="st-speed" min="10" max="160" step="2"><b id="st-speed-v"></b></span></label>
      <label class="check"><input type="checkbox" id="st-auto" checked> Speed up when I'm accurate (≥90% of ${BLOCK} notes)</label>
      <label class="check"><input type="checkbox" id="st-tick" checked> Tick</label>
    </div>
    <div class="row">
      <button class="primary" id="st-start">▶ Start <kbd>Space</kbd></button>
      <div class="feedback" id="st-fb">Play each note as it reaches the blue line.</div>
    </div>
    <svg id="st-svg" class="stream" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="stats" id="st-stats"></div>`;
  svg = $('st-svg') as unknown as SVGSVGElement;

  $<HTMLInputElement>('st-speed').value = String(store.reading.streamNpm || 30);
  showSpeed();
  $<HTMLInputElement>('st-speed').oninput = () => {
    store.reading.streamNpm = npm();
    save();
    showSpeed();
  };
  $('st-pace').addEventListener('change', () => {
    $('st-flow-opts').classList.toggle('hidden', !flow());
    reset();
  });
  $('st-flow-opts').classList.add('hidden');
  for (const id of ['st-ahead', 'st-move']) $(id).addEventListener('change', () => reset());
  $('st-start').onclick = () => (running ? stop() : start());
  $('st-start').addEventListener('click', () => $('st-start').blur());
  window.addEventListener('resize', () => root.offsetParent && drawStatic());
}

function showSpeed() {
  $('st-speed-v').textContent = `${npm()} notes/min`;
}

export function show() {
  drawStatic();
  if (!items.length) reset();
  render();
}

export function hide() {
  stop();
}

export const isRunning = () => running;

/** Rebuild the stream (e.g. after clef or range changes). */
export function reset() {
  const wasRunning = running;
  stop(true);
  items = [];
  lastCur = null;
  p = 0;
  drawStatic();
  fill();
  render();
  if (wasRunning) start();
}

export function start() {
  stop(true);
  items = [];
  lastCur = null;
  stats = { ok: 0, judged: 0, misses: 0, streak: 0, best: 0, okTimes: [], start: performance.now() };
  block = { n: 0, ok: 0 };
  synth.audio;
  drawStatic();
  // In "keep moving" the first note starts a few slots to the right, like a count-in.
  p = flow() ? -3 : 0;
  fill();
  running = true;
  lastTs = performance.now();
  $('st-start').innerHTML = '■ Stop <kbd>Space</kbd>';
  fb(flow() ? 'Get ready… play each note as it reaches the line.' : 'Play the blue note. The stream moves when you get it right.');
  updateStats();
  svg.scrollIntoView({ block: 'center', behavior: 'smooth' });
  raf = requestAnimationFrame(frame);
}

export function stop(silent = false) {
  if (!running) return;
  running = false;
  cancelAnimationFrame(raf);
  kbd.clear('hint');
  $('st-start').innerHTML = '▶ Start <kbd>Space</kbd>';
  if (silent || !stats.judged) return;
  const acc = Math.round((stats.ok / stats.judged) * 100);
  const speed = flow() ? `${npm()} notes/min` : readingSpeed() ? `${readingSpeed()} notes/min` : '';
  fb(`Session: ${stats.judged} notes, ${acc}% first try${speed ? `, ${speed}` : ''}. Nice work!`, 'good');
}

// ---------------- stream mechanics ----------------

function firstPending(): Item | null {
  return items.find((it) => it.state === 'pending') ?? null;
}

/** Keep enough notes generated ahead, and forget ones that scrolled away. */
function fill() {
  items = items.filter((it) => it.n > p - 4);
  const cur = firstPending();
  const need = (cur ? cur.n : Math.max(0, Math.ceil(p))) + ahead() + 2;
  while (!items.length || items[items.length - 1].n < need) {
    const prev = items.length ? items[items.length - 1] : null;
    const note = deps.next(prev, val('st-move') as Movement);
    items.push({ ...note, n: prev ? prev.n + 1 : Math.max(0, Math.ceil(p)), state: 'pending', wrong: 0, since: 0, flashUntil: 0 });
  }
}

function frame(ts: number) {
  if (!running) return;
  const dt = Math.min(0.1, (ts - lastTs) / 1000);
  lastTs = ts;
  if (flow()) {
    const before = p;
    p += dt * rate();
    if (checked('st-tick') && Math.floor(p) > Math.floor(before)) synth.click(0, Math.floor(p) < 0);
    judgeMisses();
  } else {
    const cur = firstPending();
    if (cur) p += (cur.n - p) * Math.min(1, dt * 10);
  }
  fill();
  const cur = firstPending();
  if (cur !== lastCur) {
    lastCur = cur;
    if (cur) cur.since = performance.now();
    if (cur && deps.showHint()) kbd.setHints([cur.midi]);
    else kbd.clear('hint');
  }
  render();
  raf = requestAnimationFrame(frame);
}

/** How late (in notes) a note may be played and still count. */
const lateWindow = () => Math.max(0.35, 0.18 * rate());

function judgeMisses() {
  for (const it of items) {
    if (it.state === 'pending' && p - it.n > lateWindow()) {
      it.state = 'miss';
      stats.misses++;
      judged(it, false, 0);
      fb(`Missed ${it.name}`, 'bad');
    }
  }
}

export function noteOn(e: NoteEvt) {
  if (!running) return;
  if (flow()) flowNote(e);
  else waitNote(e);
}

function waitNote(e: NoteEvt) {
  const cur = firstPending();
  if (!cur) return;
  if (deps.matches(e.midi, cur)) {
    cur.state = 'ok';
    kbd.flash(e.midi, 'good');
    judged(cur, !cur.wrong, e.time - cur.since);
    fb(cur.wrong ? `✓ ${cur.name}` : '✓', 'good');
  } else {
    cur.wrong++;
    cur.flashUntil = performance.now() + 350;
    kbd.flash(e.midi, 'bad');
    // After two misses, tell them the name so they're not stuck.
    fb(cur.wrong >= 2 ? `✗ That was ${midiToName(e.midi)}. This note is ${cur.name}.` : `✗ That was ${midiToName(e.midi)} — look again`, 'bad');
    if (cur.wrong === 1) {
      stats.streak = 0;
      updateStats();
    }
  }
}

function flowNote(e: NoteEvt) {
  // Where the stream was when the key was actually pressed (corrects for mic delay).
  const pe = p - ((performance.now() - e.time) / 1000) * rate();
  const inWindow = items.filter((it) => it.state === 'pending' && it.n - pe <= 0.5 && pe - it.n <= lateWindow());
  if (!inWindow.length) {
    kbd.flash(e.midi, 'bad');
    return fb('Too early — wait until the note reaches the line', 'warn');
  }
  const hit = inWindow.find((it) => deps.matches(e.midi, it));
  if (hit) {
    hit.state = 'ok';
    kbd.flash(e.midi, 'good');
    judged(hit, !hit.wrong, e.time - hit.since);
    fb('✓', 'good');
  } else {
    const it = inWindow[0];
    it.wrong++;
    it.flashUntil = performance.now() + 350;
    kbd.flash(e.midi, 'bad');
    fb(`✗ That was ${midiToName(e.midi)}`, 'bad');
  }
}

function judged(it: Item, firstTry: boolean, ms: number) {
  deps.record(it, firstTry, ms);
  stats.judged++;
  if (firstTry) {
    stats.ok++;
    stats.streak++;
    stats.best = Math.max(stats.best, stats.streak);
    stats.okTimes.push(performance.now());
    if (stats.okTimes.length > 20) stats.okTimes.shift();
  } else stats.streak = 0;

  block.n++;
  if (firstTry) block.ok++;
  if (block.n >= BLOCK) {
    const acc = block.ok / block.n;
    block = { n: 0, ok: 0 };
    if (flow()) {
      if (acc >= 0.9) {
        store.reading.bestStreamNpm = Math.max(store.reading.bestStreamNpm, npm());
        if (checked('st-auto')) setSpeed(npm() + 2, `🎉 ${Math.round(acc * 100)}% — speeding up to`);
      } else if (acc < 0.6 && checked('st-auto') && npm() > 10) {
        setSpeed(npm() - 2, `Slowing down a little to`);
      }
    } else {
      const sp = readingSpeed();
      if (sp && acc >= 0.9) store.reading.bestWaitNpm = Math.max(store.reading.bestWaitNpm, sp);
    }
    save();
  }
  updateStats();
}

function setSpeed(v: number, msg: string) {
  $<HTMLInputElement>('st-speed').value = String(clamp(v, 10, 160));
  store.reading.streamNpm = npm();
  showSpeed();
  setTimeout(() => fb(`${msg} ${npm()} notes/min`, 'good'), 400);
}

/** Correct notes per minute over the last 20 correct notes. */
function readingSpeed(): number {
  const t = stats.okTimes;
  if (t.length < 5) return 0;
  return Math.round(((t.length - 1) / (t[t.length - 1] - t[0])) * 60000);
}

function updateStats() {
  const acc = stats.judged ? `${Math.round((stats.ok / stats.judged) * 100)}%` : '–';
  let html = stat(`${stats.ok}/${stats.judged}`, 'first try') + stat(acc, 'accuracy') + stat(String(stats.streak), 'streak') + stat(String(stats.best), 'best streak');
  if (flow()) {
    html += stat(String(stats.misses), 'missed') + stat(`${npm()}`, 'notes/min');
    if (store.reading.bestStreamNpm) html += stat(String(store.reading.bestStreamNpm), 'best speed');
  } else {
    html += stat(readingSpeed() ? String(readingSpeed()) : '–', 'notes/min');
    if (store.reading.bestWaitNpm) html += stat(String(store.reading.bestWaitNpm), 'best notes/min');
  }
  $('st-stats').innerHTML = html;
}

function fb(text: string, cls: 'good' | 'bad' | 'warn' | '' = '') {
  const el = $('st-fb');
  el.textContent = text;
  el.className = 'feedback ' + (cls ? cls + '-t' : '');
}

// ---------------- drawing ----------------

const yOf = (clef: Clef, d: number) => staffTop[clef]! + 4 * S - (d - BOTTOM[clef]) * (S / 2);

function drawStatic() {
  if (!svg) return;
  width = svg.clientWidth || 900;
  const clefs = deps.clefs();
  staffTop = {};
  if (clefs.length === 2) {
    staffTop.treble = MARGIN;
    staffTop.bass = MARGIN + 4 * S + 6 * S;
  } else staffTop[clefs[0]] = MARGIN;
  height = Math.max(...clefs.map((c) => staffTop[c]!)) + 4 * S + MARGIN + 18;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.height = `${height}px`;

  let h = `<rect x="${PLAY_X - SPACING * 0.38}" y="6" width="${SPACING * 0.76}" height="${height - 12}" rx="10" fill="#5b7cff" opacity="0.13"/>`;
  h += `<line x1="${PLAY_X}" y1="6" x2="${PLAY_X}" y2="${height - 6}" stroke="#5b7cff" stroke-width="2" stroke-dasharray="5 5" opacity="0.7"/>`;
  for (const c of clefs) {
    const top = staffTop[c]!;
    for (let i = 0; i < 5; i++) h += `<line x1="12" y1="${top + i * S}" x2="${width - 12}" y2="${top + i * S}" stroke="#444" stroke-width="1.2"/>`;
    h += c === 'treble'
      ? `<text x="14" y="${top + 5 * S}" font-size="${S * 10}" class="clef">𝄞</text>`
      : `<text x="16" y="${top + 2.8 * S}" font-size="${S * 4.6}" class="clef">𝄢</text>`;
  }
  if (clefs.length === 2) h += `<line x1="12" y1="${staffTop.treble}" x2="12" y2="${staffTop.bass! + 4 * S}" stroke="#444" stroke-width="2"/>`;
  h += `<g id="st-notes"></g>`;
  svg.innerHTML = h;
  notesG = svg.querySelector('#st-notes')!;
}

function render() {
  if (!notesG) return;
  const cur = firstPending();
  const limit = cur ? cur.n + ahead() : Infinity;
  let h = '';
  for (const it of items) {
    if (it.n >= limit) continue;
    const x = PLAY_X + (it.n - p) * SPACING;
    if (x > width - 24 || x < 70) continue;
    const opacity = x < PLAY_X - 8 ? clamp(1 - (PLAY_X - x) / (1.5 * SPACING), 0, 1) : 1;
    h += noteSvg(it, x, opacity, it === cur);
  }
  notesG.innerHTML = h;
}

function noteSvg(it: Item, x: number, opacity: number, current: boolean): string {
  const d = diatonic(it.name);
  const b = BOTTOM[it.clef];
  const y = yOf(it.clef, d);
  const color =
    it.state === 'ok' ? '#16a34a'
    : it.state === 'miss' || performance.now() < it.flashUntil ? '#dc2626'
    : current && running ? '#2f55e4'
    : '#111';
  const rx = S * 0.68;
  const ry = S * 0.48;
  let h = `<g opacity="${opacity.toFixed(2)}">`;
  const ledger = (ly: number) => `<line x1="${x - rx * 1.6}" y1="${ly}" x2="${x + rx * 1.6}" y2="${ly}" stroke="#444" stroke-width="1.3"/>`;
  for (let l = b - 2; l >= d; l -= 2) h += ledger(yOf(it.clef, l));
  for (let l = b + 10; l <= d; l += 2) h += ledger(yOf(it.clef, l));
  h += `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(-20 ${x} ${y})" fill="${color}"/>`;
  h += d < b + 4
    ? `<line x1="${x + rx - 1}" y1="${y}" x2="${x + rx - 1}" y2="${y - 3.5 * S}" stroke="${color}" stroke-width="1.6"/>`
    : `<line x1="${x - rx + 1}" y1="${y}" x2="${x - rx + 1}" y2="${y + 3.5 * S}" stroke="${color}" stroke-width="1.6"/>`;
  const acc = it.name[1] === '#' ? '♯' : it.name[1] === 'b' ? '♭' : '';
  if (acc) h += `<text x="${x - rx - 3}" y="${y + S * 0.55}" font-size="${S * 1.9}" text-anchor="end" fill="${color}">${acc}</text>`;
  if (checked('st-names')) h += `<text x="${x}" y="${height - 10}" font-size="14" text-anchor="middle" fill="#666">${it.name}</text>`;
  return h + '</g>';
}

const stat = (v: string, k: string) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
