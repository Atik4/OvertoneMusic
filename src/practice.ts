import { KeyEnum, KeyInstruction, OpenSheetMusicDisplay, PointF2D, TransposeCalculator } from 'opensheetmusicdisplay';
import { PIECES, pieceTitle, type Piece } from './pieces';
import { toMusicXML } from './score';
import { synth } from './synth';
import { kbd } from './keyboard';
import { isTypingTarget, type NoteEvt } from './input';
import { store, save, pieceProgress, saveUpload, loadUpload, deleteUpload, type Hands } from './storage';
import { clamp, midiToName } from './music';
import * as player from './player';
import { canSimplify, simplifyLeftHand, type LeftHand } from './simplify';
import type { SNote, Step } from './player';

interface Expected { midi: number; t: number; measure: number; step: number; hit: boolean; missed: boolean }
interface SoundEvent { t: number; midi?: number; dur?: number; accent?: boolean }

interface WaitRun {
  mode: 'wait';
  list: Step[];
  pos: number;
  got: Set<number>;
  stepErr: boolean;
  clean: number;
  errors: number;
  measureErr: Map<number, number>;
  t0: number;
}
interface TimedRun {
  mode: 'tempo';
  list: Step[];
  pct: number;
  spq: number;
  t0q: number;
  startCtx: number;
  startPerf: number;
  endSec: number;
  win: number;
  events: SoundEvent[];
  evPos: number;
  exp: Expected[];
  missPos: number;
  cursorPos: number;
  extras: number;
  offsets: number[];
  autoplayed: { midi: number; t: number }[];
  measureErr: Map<number, number>;
  raf: number;
}

let root: HTMLElement;
let osmd: OpenSheetMusicDisplay;
let steps: Step[] = [];
let staffCount = 1;
let baseBpm = 80;
/** The piece's written key, for naming the keys you can transpose to. */
let writtenKey = { fifths: 0, minor: false };
let beatsPerBar = 4;
let beatQ = 1;
let measureCount = 0;
let pieceId = '';
let curIdx = 0;
/** Step clicked on the sheet: Start and Play begin here instead of at the first bar. */
let fromIdx = 0;
/** The piece's music as loaded, before any left-hand simplification. */
let sourceXml = '';
let visible = false;
let loaded = false;
let run: WaitRun | TimedRun | null = null;
let repeatTimer: number | undefined;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
const bump = (m: Map<number, number>, k: number) => m.set(k, (m.get(k) ?? 0) + 1);
const hands = () => $<HTMLSelectElement>('p-hands').value as Hands;
const mode = () => $<HTMLSelectElement>('p-mode').value as 'wait' | 'tempo';
const showMode = () => $<HTMLSelectElement>('p-show').value as 'all' | 'bar' | 'note';
const tempoPct = () => Number($<HTMLInputElement>('p-tempo').value);
const checked = (id: string) => $<HTMLInputElement>(id).checked;

export function init(el: HTMLElement) {
  root = el;
  el.innerHTML = `
  <div class="panel row">
    <label class="field">Piece <select id="p-piece"></select></label>
    <label class="btn">📂 Open MusicXML…<input type="file" id="p-file" accept=".xml,.musicxml,.mxl" hidden></label>
    <button id="p-del" class="hidden" title="Remove this uploaded piece">🗑</button>
    <label class="field">Hands
      <select id="p-hands"><option value="right">Right hand</option><option value="left">Left hand</option><option value="both">Both hands</option></select></label>
    <label class="field">Mode
      <select id="p-mode"><option value="wait">Wait for me — learn the notes</option><option value="tempo">Play along — keep the beat</option></select></label>
    <label class="field">Show
      <select id="p-show"><option value="all">Whole piece</option><option value="bar">One bar at a time</option><option value="note">One note at a time</option></select></label>
    <label class="field">Key <select id="p-key"></select></label>
    <label class="field">Left hand
      <select id="p-lh"><option value="written">As written</option><option value="chords">Easier: block chords</option><option value="bass">Easiest: bass notes</option></select></label>
    <label class="field">Bars <span class="row tight"><input id="p-from" type="number" min="1" placeholder="from"> – <input id="p-to" type="number" min="1" placeholder="to"></span></label>
  </div>
  <div class="panel row">
    <label class="field grow">Speed <span class="row tight"><input id="p-tempo" type="range" min="25" max="200" step="5"><b id="p-tempo-v"></b></span></label>
    <span class="row hidden" id="p-along-opts">
      <label class="check"><input type="checkbox" id="p-auto" checked> Speed trainer: +<input id="p-step" type="number" value="5" min="1" max="25">% after a ≥90% run, up to <input id="p-target" type="number" value="100" min="30" max="200">%</label>
      <label class="check"><input type="checkbox" id="p-metro" checked> Metronome</label>
      <label class="check"><input type="checkbox" id="p-other" checked> Play other hand for me</label>
    </span>
    <label class="check"><input type="checkbox" id="p-repeat"> Auto-repeat</label>
    <label class="check"><input type="checkbox" id="p-hints" checked> Show keys</label>
  </div>
  <div class="panel row">
    <button class="primary" id="p-start">▶ Start <kbd>Space</kbd></button>
    <button id="p-stop">■ Stop</button>
    <div class="feedback" id="p-fb">Pick a piece, choose a hand, press Start.</div>
    <div class="stats" id="p-stats"></div>
  </div>
  <div class="panel hidden" id="p-result"></div>
  <div class="panel player" id="p-player"></div>
  <div class="score" id="p-score"></div>`;

  osmd = new OpenSheetMusicDisplay($('p-score'), {
    autoResize: false, // we re-render ourselves on resize, see onResize()
    backend: 'svg',
    drawPartNames: false,
    followCursor: false, // turned on only while playing, so loading doesn't scroll the page
    cursorsOptions: [{ type: 0, color: '#3b82f6', alpha: 0.4, follow: true }],
  });
  osmd.TransposeCalculator = new TransposeCalculator();

  fillPieceSelect();
  void checkPieceFiles();
  $<HTMLSelectElement>('p-piece').onchange = (e) => void loadPiece((e.target as HTMLSelectElement).value);
  $<HTMLInputElement>('p-file').onchange = onUpload;
  $('p-del').onclick = () => {
    if (!pieceId.startsWith('up:') || !confirm('Remove this uploaded piece from the app?')) return;
    deleteUpload(pieceId);
    fillPieceSelect();
    void loadPiece(PIECES[0].id);
  };
  $('p-start').onclick = () => start();
  $<HTMLSelectElement>('p-mode').onchange = onModeChange;
  $<HTMLSelectElement>('p-show').value = store.settings.practiceShow;
  $<HTMLSelectElement>('p-show').onchange = () => {
    store.settings.practiceShow = showMode();
    save();
    applyReveal();
  };
  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(onResize, 250);
  });
  player.init($('p-player'), {
    steps: () => steps,
    measureCount: () => measureCount,
    qps: () => (baseBpm * tempoPct()) / 100 / 60,
    beatQ: () => beatQ,
    beatsPerBar: () => beatsPerBar,
    staffCount: () => staffCount,
    barRange,
    onStep: (idx) => moveCursorTo(idx),
    onPlay: () => {
      stop();
      osmd.FollowCursor = true;
    },
  });
  $('p-stop').onclick = () => stop('Stopped.');
  $<HTMLInputElement>('p-tempo').oninput = () => {
    pieceProgress(pieceId).tempoPct = tempoPct();
    save();
    showTempo();
  };
  $<HTMLSelectElement>('p-key').onchange = () => {
    pieceProgress(pieceId).transpose = Number($<HTMLSelectElement>('p-key').value);
    save();
    transpose();
  };
  $<HTMLSelectElement>('p-lh').onchange = () => {
    pieceProgress(pieceId).leftHand = $<HTMLSelectElement>('p-lh').value as LeftHand;
    save();
    void loadPiece(pieceId, sourceXml);
  };
  $<HTMLSelectElement>('p-hands').onchange = () => {
    pieceProgress(pieceId).hands = hands();
    save();
    stop();
    showWaitHints();
  };
  $<HTMLInputElement>('p-hints').onchange = () => (checked('p-hints') ? showWaitHints() : kbd.clear('hint'));
  for (const id of ['p-from', 'p-to']) $(id).addEventListener('change', () => ((fromIdx = 0), stop(), showWaitHints()));
  $('p-score').addEventListener('click', onScoreClick);
  for (const b of root.querySelectorAll('button')) b.addEventListener('click', () => b.blur());

  document.addEventListener('keydown', (e) => {
    if (!visible || isTypingTarget(e.target)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (run) stop('Stopped.');
      else start();
    } else if (e.key === 'Escape') stop('Stopped.');
  });
}

export function show() {
  visible = true;
  if (!loaded) void loadPiece($<HTMLSelectElement>('p-piece').value);
  else showWaitHints();
}

export function hide() {
  visible = false;
  stop();
  player.pause();
}

/** Pieces whose file isn't deployed (the copyrighted ones stay out of git) are left out of the list. */
const missing = new Set<string>();

async function checkPieceFiles() {
  await Promise.all(
    PIECES.filter((p) => p.file).map(async (p) => {
      const res = await fetch(import.meta.env.BASE_URL + p.file, { method: 'HEAD' }).catch(() => null);
      // Vite's dev server answers unknown paths with index.html, so a web page counts as missing too.
      if (!res?.ok || res.headers.get('content-type')?.includes('text/html')) missing.add(p.id);
    }),
  );
  if (missing.size) fillPieceSelect();
}

function fillPieceSelect() {
  const sel = $<HTMLSelectElement>('p-piece');
  const groups = new Map<string, string[]>();
  for (const p of PIECES.filter((p) => !missing.has(p.id))) groups.set(p.level, [...(groups.get(p.level) ?? []), `<option value="${p.id}">${pieceTitle(p)}</option>`]);
  if (store.uploads.length) groups.set('My music', store.uploads.map((u) => `<option value="${u.id}">${u.title.replace(/</g, '&lt;')}</option>`));
  sel.innerHTML = [...groups].map(([g, opts]) => `<optgroup label="${g}">${opts.join('')}</optgroup>`).join('');
  if (pieceId) sel.value = pieceId;
}

async function onUpload(e: Event) {
  const inp = e.target as HTMLInputElement;
  const f = inp.files?.[0];
  inp.value = '';
  if (!f) return;
  const isMxl = /\.mxl$/i.test(f.name);
  const data = isMxl ? await readBinaryString(f) : await f.text();
  const { id, saved } = saveUpload(f.name.replace(/\.(musicxml|xml|mxl)$/i, ''), data);
  if (saved) {
    fillPieceSelect();
    $<HTMLSelectElement>('p-piece').value = id;
    await loadPiece(id);
  } else {
    await loadPiece(id, data);
    fb('Loaded, but the file is too big to remember for next time.', 'warn');
  }
}

function readBinaryString(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsBinaryString(f);
  });
}

async function loadPiece(id: string, raw?: string) {
  stop();
  pieceId = id;
  $('p-del').classList.toggle('hidden', !id.startsWith('up:'));
  $('p-result').classList.add('hidden');
  const piece = PIECES.find((p) => p.id === id);
  const data = raw ?? (piece ? await pieceXML(piece) : loadUpload(id));
  if (pieceId !== id) return; // another piece was picked while this one was downloading
  if (!data) return fb(piece ? `Couldn't find ${piece.file}.` : 'That file is no longer saved. Please open it again.', 'bad');
  sourceXml = data;
  try {
    await osmd.load(simplifyLeftHand(data, pieceProgress(id).leftHand ?? 'written'));
    writtenKey = readKey();
    osmd.Sheet.Transpose = pieceProgress(id).transpose ?? 0;
    if (osmd.Sheet.Transpose) osmd.updateGraphic();
    osmd.render();
  } catch (err) {
    return fb(`Couldn't open this music: ${(err as Error).message ?? err}`, 'bad');
  }
  loaded = true;
  fromIdx = 0;
  analyze();
  player.load();
  const prog = pieceProgress(id);
  $<HTMLSelectElement>('p-hands').value = staffCount < 2 ? 'both' : prog.hands;
  $<HTMLSelectElement>('p-hands').disabled = staffCount < 2;
  $<HTMLInputElement>('p-tempo').value = String(prog.tempoPct);
  fillKeySelect(prog.transpose ?? 0);
  const lh = $<HTMLSelectElement>('p-lh');
  lh.value = prog.leftHand ?? 'written';
  lh.disabled = staffCount < 2 || !canSimplify(data);
  lh.title = lh.disabled ? (staffCount < 2 ? 'This piece has no left-hand part.' : 'Not available for zipped .mxl files.') : '';
  $<HTMLInputElement>('p-from').value = '';
  $<HTMLInputElement>('p-to').value = '';
  $<HTMLInputElement>('p-from').max = $<HTMLInputElement>('p-to').max = String(measureCount);
  showTempo();
  osmd.cursor.show();
  curIdx = 0;
  osmd.cursor.reset();
  showWaitHints();
  applyReveal();
  fb('Ready. Press Start (or Space).');
}

async function pieceXML(p: Piece): Promise<string | null> {
  if (!p.file) return toMusicXML(p.spec!);
  const res = await fetch(import.meta.env.BASE_URL + p.file).catch(() => null);
  return res?.ok ? res.text() : null;
}

function analyze() {
  const sheet = osmd.Sheet;
  measureCount = sheet.SourceMeasures.length;
  const ts = sheet.SourceMeasures[0]?.ActiveTimeSignature;
  beatsPerBar = ts?.Numerator || 4;
  beatQ = 4 / (ts?.Denominator || 4);
  baseBpm = sheet.HasBPMInfo && sheet.DefaultStartTempoInBpm > 0 ? sheet.DefaultStartTempoInBpm : 80;
  staffCount = sheet.Staves.length;

  steps = [];
  const c = osmd.cursor;
  c.hide();
  c.reset();
  let idx = 0;
  while (!c.Iterator.EndReached) {
    const notes: SNote[] = [];
    for (const n of c.NotesUnderCursor()) {
      if (n.isRest() || n.IsGraceNote || n.ParentVoiceEntry?.IsGrace) continue;
      if (n.NoteTie && n.NoteTie.StartNote !== n) continue; // held from a tie, not a new key press
      // OSMD halfTone: C4 = 48, MIDI C4 = 60.
      notes.push({ midi: n.halfTone + 12, staff: n.ParentStaff?.idInMusicSheet ?? 0, durQ: n.Length.RealValue * 4 });
    }
    steps.push({ idx, timeQ: c.Iterator.CurrentEnrolledTimestamp.RealValue * 4, measure: c.Iterator.CurrentMeasureIndex, notes, els: noteElements() });
    c.next();
    idx++;
  }
  c.reset();
}

/** SVG groups of the notes under the cursor (head, stem, accidental, ledger lines), so we can hide them. */
function noteElements(): SVGGElement[] {
  const els: SVGGElement[] = [];
  for (const g of osmd.cursor.GNotesUnderCursor()) {
    const el = (g as unknown as { getSVGGElement?: () => SVGGElement }).getSVGGElement?.();
    if (!el) continue;
    els.push(el);
    // VexFlow draws a note's ledger lines as a separate group just before it.
    const prev = el.previousElementSibling;
    if (prev instanceof SVGGElement && prev.classList.contains('vf-ledgers')) els.push(prev);
  }
  return els;
}

const MAJOR_KEYS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MINOR_KEYS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];

function readKey() {
  const key = osmd.Sheet.SourceMeasures[0]?.FirstInstructionsStaffEntries[0]?.Instructions.find((i) => i instanceof KeyInstruction);
  return { fifths: key?.Key ?? 0, minor: key?.Mode === KeyEnum.minor || key?.Mode === KeyEnum.aeolian };
}

/** Key choices from 6 semitones down to 6 up, named from the written key. */
function fillKeySelect(semis: number) {
  const tonic = (((writtenKey.fifths * 7) % 12) + 12 + (writtenKey.minor ? 9 : 0)) % 12;
  const opts = [];
  for (let t = -6; t <= 6; t++) {
    const name = `${(writtenKey.minor ? MINOR_KEYS : MAJOR_KEYS)[(tonic + t + 12) % 12]} ${writtenKey.minor ? 'minor' : 'major'}`;
    opts.push(`<option value="${t}">${name}${t ? ` (${t > 0 ? '+' : '−'}${Math.abs(t)})` : ' (as written)'}</option>`);
  }
  $<HTMLSelectElement>('p-key').innerHTML = opts.join('');
  $<HTMLSelectElement>('p-key').value = String(semis);
}

/** Redraw the music in the chosen key; the notes to play and the Player follow it. */
function transpose() {
  if (!loaded) return;
  stop();
  player.pause();
  osmd.Sheet.Transpose = pieceProgress(pieceId).transpose ?? 0;
  osmd.updateGraphic();
  osmd.render();
  analyze();
  player.load();
  fromIdx = 0;
  osmd.cursor.show();
  curIdx = 0;
  osmd.cursor.reset();
  showWaitHints();
  applyReveal();
  fb('Ready. Press Start (or Space).');
}

/** Re-render to fit the new width, then re-link note elements and put the cursor back. */
function onResize() {
  if (!loaded || !visible) return;
  const at = curIdx;
  osmd.render();
  const c = osmd.cursor;
  c.hide();
  c.reset();
  for (const s of steps) {
    s.els = noteElements();
    c.next();
  }
  c.show();
  c.reset();
  curIdx = 0;
  moveCursorTo(at);
}

/**
 * "One bar / one note at a time": hide what's coming so you have to read it, fade what's done.
 * In play-along you see one note or bar ahead, so there's time to read it before it's due.
 */
function applyReveal() {
  const m = showMode();
  const cur = steps[curIdx];
  const timed = run?.mode === 'tempo';
  const nextNote = steps.slice(curIdx + 1).find((s) => s.notes.length);
  for (const s of steps) {
    let op = 1;
    if (m !== 'all' && cur) {
      if (m === 'bar') {
        if (s.measure < cur.measure) op = 0.15;
        else if (s.measure > cur.measure + (timed ? 1 : 0)) op = 0;
      } else {
        if (s.idx < curIdx) op = 0.15;
        else if (s.idx > curIdx && !(timed && s === nextNote)) op = 0;
      }
    }
    for (const el of s.els) el.style.opacity = op === 1 ? '' : String(op);
  }
}

function handOk(staff: number) {
  if (staffCount < 2) return true;
  const h = hands();
  return h === 'both' || (h === 'right' ? staff === 0 : staff === 1);
}
const required = (s: Step) => s.notes.filter((n) => handOk(n.staff));

/** Bars chosen in the "Bars" fields, 0-based and inclusive (whole piece if empty). */
function barRange(): [number, number] {
  const from = clamp((parseInt($<HTMLInputElement>('p-from').value) || 1) - 1, 0, measureCount - 1);
  const to = clamp((parseInt($<HTMLInputElement>('p-to').value) || measureCount) - 1, from, measureCount - 1);
  return [from, to];
}

function rangeSteps(): Step[] {
  const [from, to] = barRange();
  const list = steps.filter((s) => s.measure >= from && s.measure <= to);
  // Start from the note clicked on the sheet, if it's inside the chosen bars.
  const at = list.findIndex((s) => s.idx === fromIdx);
  return at > 0 ? list.slice(at) : list;
}

/** Click a note (or anywhere near it) on the sheet: move the cursor there, so Start and Play begin from it. */
function onScoreClick(e: MouseEvent) {
  if (!loaded) return;
  const sheet = osmd.GraphicSheet;
  const entry = sheet.GetNearestStaffEntry(sheet.svgToOsmd(sheet.domToSvg(new PointF2D(e.clientX, e.clientY))));
  const measure = entry ? osmd.Sheet.SourceMeasures.indexOf(entry.parentMeasure.parentSourceMeasure) : -1;
  if (measure < 0) return;
  // The first time the music reaches that bar (repeats visit it again later), at the clicked beat.
  const first = steps.findIndex((s) => s.measure === measure);
  if (first < 0) return;
  const at = steps[first].timeQ + entry.relInMeasureTimestamp.RealValue * 4;
  let idx = first;
  while (steps[idx + 1]?.measure === measure && steps[idx + 1].timeQ <= at + 1e-6) idx++;
  const wasPlaying = player.isPlaying();
  stop();
  fromIdx = idx;
  if (wasPlaying) player.seekToStep(idx);
  else {
    player.seekToStep(idx);
    moveCursorTo(idx);
    showWaitHints();
  }
  fb(`From bar ${measure + 1}. Press Start to practise or ▶ Play to listen.`);
}

function moveCursorTo(idx: number) {
  const c = osmd.cursor;
  if (idx < curIdx) {
    c.reset();
    curIdx = 0;
  }
  while (curIdx < idx) {
    c.next();
    curIdx++;
  }
  applyReveal();
}

const MODE_HELP = {
  wait: 'Wait for me: the cursor waits until you play the right note(s). No clock — focus on reading.',
  tempo: 'Play along: 1 bar count-in, then the music moves at the speed below. Play each note on time.',
};

function showStartLabel() {
  $('p-start').innerHTML = `▶ ${mode() === 'tempo' ? 'Start play-along' : 'Start'} <kbd>Space</kbd>`;
}

function onModeChange() {
  $('p-along-opts').classList.toggle('hidden', mode() !== 'tempo');
  $('p-result').classList.add('hidden');
  const wasRunning = !!run;
  stop();
  showStartLabel();
  // Switching mid-run restarts straight away in the new mode.
  if (wasRunning) start();
  else {
    fb(MODE_HELP[mode()]);
    showWaitHints();
  }
}

function showTempo() {
  const pct = tempoPct();
  $('p-tempo-v').textContent = `${pct}% · ${Math.round((baseBpm * pct) / 100)} BPM`;
}

function fb(text: string, cls: 'good' | 'bad' | 'warn' | '' = '') {
  const el = $('p-fb');
  el.textContent = text;
  el.className = 'feedback ' + (cls ? cls + '-t' : '');
}

function setHints(notes: SNote[]) {
  if (checked('p-hints')) kbd.setHints(notes.map((n) => n.midi));
  else kbd.clear('hint');
}

/** When idle: park the cursor on the first note to play and hint it. */
function showWaitHints() {
  if (!loaded || run) return;
  const first = rangeSteps().find((s) => required(s).length);
  if (first) moveCursorTo(first.idx);
  setHints(first ? required(first) : []);
}

// ---------------- run control ----------------

function start() {
  if (!loaded) return;
  stop();
  synth.audio; // unlock audio on this click
  $('p-result').classList.add('hidden');
  player.pause();
  if (mode() === 'wait') startWait();
  else startTimed();
  osmd.FollowCursor = true;
  $('p-start').innerHTML = '↺ Restart <kbd>Space</kbd>';
}

function stop(msg?: string) {
  clearTimeout(repeatTimer);
  if (osmd) osmd.FollowCursor = false;
  if (!run) return;
  if (run.mode !== 'wait') cancelAnimationFrame(run.raf);
  synth.stopAll();
  run = null;
  kbd.clear('hint');
  applyReveal();
  showStartLabel();
  if (msg) fb(msg);
}

export function noteOn(e: NoteEvt) {
  if (!run) return;
  if (run.mode === 'wait') waitNote(run, e);
  else if (run.mode === 'tempo') timedNote(run, e);
}

// ---------------- "Wait for me" mode ----------------

function startWait() {
  const list = rangeSteps().filter((s) => required(s).length);
  if (!list.length) return fb('No notes for this hand in those bars.', 'bad');
  run = { mode: 'wait', list, pos: 0, got: new Set(), stepErr: false, clean: 0, errors: 0, measureErr: new Map(), t0: performance.now() };
  enterWaitStep(run);
  fb('Play the highlighted note(s). I’ll wait for you.');
}

function enterWaitStep(r: WaitRun) {
  const s = r.list[r.pos];
  moveCursorTo(s.idx);
  r.got.clear();
  r.stepErr = false;
  setHints(required(s));
  $('p-stats').innerHTML = stat(`${r.pos}/${r.list.length}`, 'notes') + stat(String(r.errors), 'mistakes');
}

function waitNote(r: WaitRun, e: NoteEvt) {
  const s = r.list[r.pos];
  const need = required(s).map((n) => n.midi);
  if (need.includes(e.midi)) {
    r.got.add(e.midi);
    kbd.flash(e.midi, 'good');
    // The mic hears one note at a time, so any note of a chord counts.
    const done = need.every((m) => r.got.has(m)) || e.source === 'mic';
    if (!done) return;
    if (!r.stepErr) r.clean++;
    fb('✓', 'good');
    r.pos++;
    if (r.pos >= r.list.length) finish();
    else enterWaitStep(r);
  } else {
    r.errors++;
    r.stepErr = true;
    bump(r.measureErr, s.measure);
    kbd.flash(e.midi, 'bad');
    fb(`You played ${midiToName(e.midi)} — looking for ${need.map(midiToName).join(' + ')}`, 'bad');
    $('p-stats').innerHTML = stat(`${r.pos}/${r.list.length}`, 'notes') + stat(String(r.errors), 'mistakes');
  }
}

// ---------------- "Play along" mode ----------------

function startTimed() {
  const list = rangeSteps();
  if (!list.length) return;
  const pct = tempoPct();
  const spq = 60 / ((baseBpm * pct) / 100);
  const t0q = list[0].timeQ;
  const endQ = Math.max(...list.map((s) => s.timeQ + Math.max(0, ...s.notes.map((n) => n.durQ))));
  const countIn = beatsPerBar * beatQ * spq;
  const lead = 0.15 + countIn;

  const events: SoundEvent[] = [];
  const exp: Expected[] = [];
  for (let b = 0; b < beatsPerBar; b++) events.push({ t: -countIn + b * beatQ * spq, accent: b === 0 });
  if (checked('p-metro')) {
    for (let b = 0; b * beatQ < endQ - t0q - 1e-6; b++) events.push({ t: b * beatQ * spq, accent: b % beatsPerBar === 0 });
  }
  const autoOther = checked('p-other') && hands() !== 'both';
  for (const s of list) {
    for (const n of s.notes) {
      const t = (s.timeQ - t0q) * spq;
      const mine = handOk(n.staff);
      if (mine) exp.push({ midi: n.midi, t, measure: s.measure, step: s.idx, hit: false, missed: false });
      else if (autoOther) events.push({ t, midi: n.midi, dur: n.durQ * spq });
    }
  }
  events.sort((a, b) => a.t - b.t);

  run = {
    mode: 'tempo', list, pct, spq, t0q,
    startCtx: synth.now() + lead,
    startPerf: performance.now() + lead * 1000,
    endSec: (endQ - t0q) * spq,
    win: clamp(0.35 * spq, 0.12, 0.3),
    events, evPos: 0, exp, missPos: 0, cursorPos: 0, extras: 0, offsets: [], autoplayed: [],
    measureErr: new Map(), raf: 0,
  };
  moveCursorTo(list[0].idx);
  setHints(required(list[0]));
  fb('Get ready…');
  run.raf = requestAnimationFrame(tick);
}

function tick() {
  const r = run;
  if (!r || r.mode === 'wait') return;
  const now = (performance.now() - r.startPerf) / 1000;

  // Schedule sound slightly ahead of time.
  while (r.evPos < r.events.length && r.events[r.evPos].t < now + 0.25) {
    const ev = r.events[r.evPos++];
    const when = r.startCtx + ev.t - synth.now();
    if (when < -0.05) continue;
    if (ev.midi === undefined) synth.click(when, ev.accent);
    else {
      synth.note(ev.midi, Math.max(0.15, ev.dur! * 0.95), when, 0.65, { track: false });
      r.autoplayed.push({ midi: ev.midi, t: ev.t });
    }
  }

  if (now < 0 && r.mode === 'tempo') {
    fb(`Count-in: ${Math.ceil(-now / (beatQ * r.spq))}`);
  }

  // Move the cursor.
  let moved = false;
  while (r.cursorPos + 1 < r.list.length && (r.list[r.cursorPos + 1].timeQ - r.t0q) * r.spq <= now + 0.02) {
    r.cursorPos++;
    moved = true;
  }
  if (moved) {
    moveCursorTo(r.list[r.cursorPos].idx);
    if (r.mode === 'tempo') {
      const next = r.list.slice(r.cursorPos).find((s) => required(s).length);
      setHints(next ? required(next) : []);
    }
  }

  // Notes whose time window has passed are misses.
  while (r.missPos < r.exp.length && now > r.exp[r.missPos].t + r.win) {
    const x = r.exp[r.missPos++];
    if (!x.hit) {
      x.missed = true;
      bump(r.measureErr, x.measure);
      kbd.flash(x.midi, 'bad');
      fb(`Missed ${midiToName(x.midi)}`, 'bad');
    }
  }

  if (r.mode === 'tempo') {
    const hits = r.exp.filter((x) => x.hit).length;
    const done = r.missPos;
    $('p-stats').innerHTML = stat(`${hits}/${r.exp.length}`, 'hit') + stat(String(r.exp.filter((x) => x.missed).length), 'missed') + stat(String(r.extras), 'extra') + stat(done ? `${Math.round((hits / Math.max(1, done)) * 100)}%` : '–', 'so far');
  }
  r.autoplayed = r.autoplayed.filter((a) => a.t > now - 1);

  if (now > r.endSec + 0.6) return finish();
  r.raf = requestAnimationFrame(tick);
}

function timedNote(r: TimedRun, e: NoteEvt) {
  const t = (e.time - r.startPerf) / 1000;
  // Ignore the mic hearing our own auto-played other hand.
  if (e.source === 'mic' && r.autoplayed.some((a) => a.midi === e.midi && t >= a.t - 0.05 && t - a.t < 0.6)) return;
  let best: Expected | null = null;
  for (let i = Math.max(0, r.missPos - 4); i < r.exp.length; i++) {
    const x = r.exp[i];
    if (x.t - t > r.win) break;
    if (x.hit || x.missed || x.midi !== e.midi || Math.abs(x.t - t) > r.win) continue;
    if (!best || Math.abs(x.t - t) < Math.abs(best.t - t)) best = x;
  }
  if (!best) {
    r.extras++;
    bump(r.measureErr, r.list[r.cursorPos].measure);
    kbd.flash(e.midi, 'bad');
    return fb(`Extra note: ${midiToName(e.midi)}`, 'bad');
  }
  best.hit = true;
  if (e.source === 'mic') for (const x of r.exp) if (x.step === best.step) x.hit = true;
  const off = t - best.t;
  r.offsets.push(off);
  kbd.flash(e.midi, 'good');
  if (Math.abs(off) < 0.07) fb('Perfect!', 'good');
  else fb(off < 0 ? `A bit early (${Math.round(-off * 1000)} ms)` : `A bit late (${Math.round(off * 1000)} ms)`, 'warn');
}

// ---------------- results & speed trainer ----------------

function finish() {
  const r = run;
  if (!r) return;
  if (r.mode !== 'wait') cancelAnimationFrame(r.raf);
  run = null;
  kbd.clear('hint');
  showStartLabel();

  const prog = pieceProgress(pieceId);
  let acc: number;
  let html: string;
  if (r.mode === 'wait') {
    acc = r.clean / r.list.length;
    const secs = Math.round((performance.now() - r.t0) / 1000);
    html = `<h3>Run complete</h3><div class="stats">${stat(pctStr(acc), 'first-try correct')}${stat(String(r.errors), 'mistakes')}${stat(`${secs}s`, 'time')}</div>`;
    html += acc >= 0.9
      ? `<p class="good-t">You know the notes. Next step: switch Mode to <b>Play along</b> at a slow speed (try ${Math.min(prog.tempoPct, 60)}%).</p>`
      : `<p>Go again — aim for 90% first-try correct before playing along with the beat.</p>`;
  } else {
    const hits = r.exp.filter((x) => x.hit).length;
    acc = r.exp.length ? hits / (r.exp.length + r.extras) : 0;
    const avg = r.offsets.length ? r.offsets.reduce((a, b) => a + b, 0) / r.offsets.length : 0;
    const timing = Math.abs(avg) < 0.03 ? 'right on the beat' : avg < 0 ? `${Math.round(-avg * 1000)} ms early on average` : `${Math.round(avg * 1000)} ms late on average`;
    const key = `${hands()}@${r.pct}`;
    const prevBest = prog.best[key] ?? 0;
    prog.best[key] = Math.max(prevBest, acc);
    html = `<h3>Run complete at ${r.pct}% speed</h3><div class="stats">${stat(pctStr(acc), 'accuracy')}${stat(`${hits}/${r.exp.length}`, 'notes hit')}${stat(String(r.extras), 'extra notes')}${stat(pctStr(prevBest), 'previous best')}</div><p>Timing: ${timing}.</p>`;

    const stepPct = Number($<HTMLInputElement>('p-step').value) || 5;
    const target = Number($<HTMLInputElement>('p-target').value) || 100;
    if (checked('p-auto')) {
      if (acc >= 0.9 && r.pct < target) {
        setTempo(Math.min(target, r.pct + stepPct));
        html += `<p class="good-t">🎉 Great run! Speed raised to <b>${tempoPct()}%</b>.</p>`;
      } else if (acc >= 0.9) {
        html += `<p class="good-t">🏆 You hit your target speed (${target}%) with ${pctStr(acc)} accuracy!</p>`;
      } else if (acc < 0.6 && r.pct > 30) {
        setTempo(Math.max(25, r.pct - stepPct));
        html += `<p>That was tough — speed lowered to <b>${tempoPct()}%</b>. Slow and correct beats fast and sloppy.</p>`;
      } else {
        html += `<p>Almost — get 90% at this speed to move up.</p>`;
      }
    }
  }

  const tough = [...r.measureErr].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (tough.length) {
    html += `<p>Tough spots: ${tough.map(([m, n]) => `<button class="link" data-bar="${m + 1}">bar ${m + 1}</button> (${n})`).join(', ')} — click one to loop it with its neighbours.</p>`;
  }
  save();
  const res = $('p-result');
  res.innerHTML = html;
  res.classList.remove('hidden');
  res.querySelectorAll<HTMLButtonElement>('[data-bar]').forEach((b) => {
    b.onclick = () => {
      const bar = Number(b.dataset.bar);
      $<HTMLInputElement>('p-from').value = String(Math.max(1, bar - 1));
      $<HTMLInputElement>('p-to').value = String(Math.min(measureCount, bar + 1));
      fb(`Looping bars ${Math.max(1, bar - 1)}–${Math.min(measureCount, bar + 1)}. Turn on Auto-repeat to drill it.`);
    };
  });
  fb(acc >= 0.9 ? 'Nice!' : 'Keep going!', acc >= 0.9 ? 'good' : '');

  if (checked('p-repeat')) repeatTimer = window.setTimeout(() => start(), 2500);
}

function setTempo(pct: number) {
  $<HTMLInputElement>('p-tempo').value = String(pct);
  pieceProgress(pieceId).tempoPct = pct;
  showTempo();
}

const pctStr = (x: number) => `${Math.round(x * 100)}%`;
const stat = (v: string, k: string) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
