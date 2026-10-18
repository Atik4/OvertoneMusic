import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { toMusicXML } from './score';
import { kbd } from './keyboard';
import { isTypingTarget, type NoteEvt } from './input';
import { store, save } from './storage';
import { diatonic, nameToMidi, pc, pick, weightedPick } from './music';
import * as stream from './stream';
import type { Clef, Movement, StreamNote } from './stream';

interface Target { name: string; midi: number; clef: Clef; shownAt: number; wrong: boolean }

// [low, high] note ranges per clef and level (naturals; accidentals added on top).
const RANGES: Record<Clef, Record<string, [string, string]>> = {
  treble: { '1': ['E4', 'F5'], '2': ['A3', 'C6'], '3': ['F3', 'E6'] },
  bass: { '1': ['G2', 'A3'], '2': ['C2', 'E4'], '3': ['A1', 'G4'] },
};
const SHARPS: Record<number, string> = { 1: 'C#', 3: 'D#', 6: 'F#', 8: 'G#', 10: 'A#' };
const FLATS: Record<number, string> = { 1: 'Db', 3: 'Eb', 6: 'Gb', 8: 'Ab', 10: 'Bb' };
const NATURAL: Record<number, string> = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' };

let root: HTMLElement;
let osmd: OpenSheetMusicDisplay;
let target: Target | null = null;
let last = '';
let session = { ok: 0, n: 0, streak: 0, best: 0, ms: 0 };
let challengeEnd = 0;
let challengeTimer: number | undefined;
let nextTimer: number | undefined;
let mode: 'cards' | 'stream' = 'cards';
let visible = false;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
const val = (id: string) => $<HTMLSelectElement>(id).value;
const checked = (id: string) => $<HTMLInputElement>(id).checked;

export function init(el: HTMLElement) {
  root = el;
  el.innerHTML = `
  <div class="panel row subtabs">
    <button data-mode="cards" class="active">Flash cards</button>
    <button data-mode="stream">Note stream</button>
    <span class="muted" id="r-mode-tip">One note at a time — find it on the piano.</span>
  </div>
  <div class="panel row">
    <label class="field">Clef <select id="r-clef"><option value="treble">Treble 𝄞 (right hand)</option><option value="bass">Bass 𝄢 (left hand)</option><option value="both">Both</option></select></label>
    <label class="field">Range <select id="r-level"><option value="1">On the staff</option><option value="2">+ ledger lines</option><option value="3">Wide</option></select></label>
    <label class="check"><input type="checkbox" id="r-acc"> Sharps &amp; flats</label>
    <label class="check"><input type="checkbox" id="r-oct"> Any octave counts</label>
    <label class="check"><input type="checkbox" id="r-hint"> Show key on keyboard</label>
  </div>
  <div class="panel hidden" id="r-stream"></div>
  <div class="panel reading-stage" id="r-cards">
    <div class="score small" id="r-score"></div>
    <div class="reading-side">
      <div class="feedback" id="r-fb">Play the note you see.</div>
      <div class="stats" id="r-stats"></div>
      <div class="row"><button id="r-reveal">Show name</button><button id="r-skip">Skip ⏭</button><button id="r-challenge" class="primary">⏱ 60-second challenge</button></div>
    </div>
  </div>
  <div class="panel"><h3>Notes to work on</h3><div id="r-weak" class="muted">Play a few notes first. Notes you miss come up more often.</div></div>`;

  osmd = new OpenSheetMusicDisplay($('r-score'), {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    drawPartNames: false,
    drawMeasureNumbers: false,
  });
  osmd.Zoom = 2.6;

  for (const id of ['r-clef', 'r-level', 'r-acc']) $(id).addEventListener('change', () => (mode === 'stream' ? stream.reset() : next()));
  $('r-hint').addEventListener('change', () => (mode === 'cards' ? showHint() : !$<HTMLInputElement>('r-hint').checked && kbd.clear('hint')));
  $('r-reveal').onclick = () => {
    if (!target) return;
    target.wrong = true;
    fb(`That's ${target.name}`);
    kbd.setHints([target.midi]);
  };
  $('r-skip').onclick = () => next();
  $('r-challenge').onclick = startChallenge;

  stream.init($('r-stream'), {
    next: nextStreamNote,
    matches: (midi, n) => (checked('r-oct') ? pc(midi) === pc(n.midi) : midi === n.midi),
    record: (n, firstTry, ms) => {
      recordNote(n.clef, n.name, firstTry, ms);
      renderWeak();
    },
    clefs: () => (val('r-clef') === 'both' ? ['treble', 'bass'] : [val('r-clef') as Clef]),
    showHint: () => checked('r-hint'),
  });

  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
    b.onclick = () => setMode(b.dataset.mode as 'cards' | 'stream');
  });
  document.addEventListener('keydown', (e) => {
    if (!visible || mode !== 'stream' || e.code !== 'Space' || isTypingTarget(e.target)) return;
    e.preventDefault();
    if (stream.isRunning()) stream.stop();
    else stream.start();
  });
}

function setMode(m: 'cards' | 'stream') {
  mode = m;
  root.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('active', (x as HTMLElement).dataset.mode === m));
  $('r-cards').classList.toggle('hidden', m !== 'cards');
  $('r-stream').classList.toggle('hidden', m !== 'stream');
  $('r-mode-tip').textContent = m === 'cards' ? 'One note at a time — find it on the piano.' : 'An endless stream of new notes. Read each one; there is no tune to memorise.';
  kbd.clear('hint');
  if (m === 'stream') {
    stopChallenge();
    stream.show();
  } else {
    stream.hide();
    if (!target) void next();
    else showHint();
  }
}

export function show() {
  visible = true;
  if (mode === 'stream') stream.show();
  else if (!target) void next();
  else showHint();
  renderWeak();
}

export function hide() {
  visible = false;
  kbd.clear('hint');
  stopChallenge();
  stream.hide();
}

const noteWeight = (clef: Clef, name: string) => {
  const s = store.reading.notes[statKey(clef, name)];
  if (!s) return 1.5;
  const errRate = s.bad / (s.ok + s.bad);
  const slow = s.ok ? s.ms / s.ok > 2500 : false;
  return 1 + errRate * 4 + (slow ? 1 : 0);
};

function recordNote(clef: Clef, name: string, firstTry: boolean, ms: number) {
  const s = (store.reading.notes[statKey(clef, name)] ??= { ok: 0, bad: 0, ms: 0 });
  if (firstTry) {
    s.ok++;
    s.ms += ms;
  } else s.bad++;
  save();
}

function nextStreamNote(prev: StreamNote | null, movement: Movement): StreamNote {
  const sel = val('r-clef');
  // With both clefs, mostly stay on one staff for a few notes, like real music.
  const clef: Clef = sel !== 'both' ? (sel as Clef) : prev && Math.random() < 0.75 ? prev.clef : pick(['treble', 'bass'] as const);
  let pool = candidates(clef).filter((c) => !prev || c.name !== prev.name);
  if (movement === 'step' && prev && prev.clef === clef) {
    const pd = diatonic(prev.name);
    const near = pool.filter((c) => Math.abs(diatonic(c.name) - pd) <= 4);
    if (near.length) pool = near;
  }
  return { ...weightedPick(pool, (c) => noteWeight(clef, c.name)), clef };
}

function candidates(clef: Clef) {
  const [lo, hi] = RANGES[clef][val('r-level')].map(nameToMidi);
  const out: { name: string; midi: number }[] = [];
  for (let m = lo; m <= hi; m++) {
    const oct = Math.floor(m / 12) - 1;
    const p = pc(m);
    if (NATURAL[p] !== undefined) out.push({ name: NATURAL[p] + oct, midi: m });
    else if (checked('r-acc')) out.push({ name: (Math.random() < 0.5 ? SHARPS[p] : FLATS[p]) + oct, midi: m });
  }
  return out;
}

const statKey = (clef: Clef, name: string) => `${clef}:${name}`;

async function next() {
  clearTimeout(nextTimer);
  const clefSel = val('r-clef');
  const clef: Clef = clefSel === 'both' ? pick(['treble', 'bass'] as const) : (clefSel as Clef);
  const pool = candidates(clef).filter((c) => c.name !== last);
  const c = weightedPick(pool, (c) => noteWeight(clef, c.name));
  last = c.name;
  const xml = toMusicXML({ [clef === 'treble' ? 'rh' : 'lh']: `${c.name}w`, hideTime: true });
  await osmd.load(xml);
  osmd.render();
  target = { ...c, clef, shownAt: performance.now(), wrong: false };
  showHint();
  updateStats();
}

function showHint() {
  if (target && checked('r-hint')) kbd.setHints([target.midi]);
  else kbd.clear('hint');
}

export function noteOn(e: NoteEvt) {
  if (mode === 'stream') return stream.noteOn(e);
  if (!target) return;
  const t = target;
  const ok = checked('r-oct') ? pc(e.midi) === pc(t.midi) : e.midi === t.midi;
  const key = statKey(t.clef, t.name);
  const s = (store.reading.notes[key] ??= { ok: 0, bad: 0, ms: 0 });
  if (ok) {
    const ms = e.time - t.shownAt;
    session.n++;
    if (!t.wrong) {
      session.ok++;
      session.streak++;
      session.best = Math.max(session.best, session.streak);
      session.ms += ms;
      s.ok++;
      s.ms += ms;
    }
    kbd.flash(e.midi, 'good');
    fb(`✓ ${t.name}  (${(ms / 1000).toFixed(1)}s)`, 'good');
    target = null;
    save();
    updateStats();
    renderWeak();
    nextTimer = window.setTimeout(() => void next(), 350);
  } else {
    if (!t.wrong) {
      s.bad++;
      session.streak = 0;
      save();
    }
    t.wrong = true;
    kbd.flash(e.midi, 'bad');
    fb('✗ Not quite — try again', 'bad');
    updateStats();
  }
}

function fb(text: string, cls: 'good' | 'bad' | '' = '') {
  const el = $('r-fb');
  el.textContent = text;
  el.className = 'feedback ' + (cls ? cls + '-t' : '');
}

function updateStats() {
  const avg = session.ok ? (session.ms / session.ok / 1000).toFixed(1) + 's' : '–';
  let html = stat(`${session.ok}/${session.n}`, 'first try') + stat(String(session.streak), 'streak') + stat(String(session.best), 'best streak') + stat(avg, 'avg time');
  if (challengeEnd) html = stat(`${Math.max(0, Math.ceil((challengeEnd - Date.now()) / 1000))}s`, 'left') + html;
  else if (store.reading.bestChallenge) html += stat(String(store.reading.bestChallenge), 'challenge best');
  $('r-stats').innerHTML = html;
}

function renderWeak() {
  const rows = Object.entries(store.reading.notes)
    .filter(([, s]) => s.ok + s.bad >= 2)
    .map(([k, s]) => ({ k, rate: s.bad / (s.ok + s.bad), avg: s.ok ? s.ms / s.ok : 0 }))
    .filter((r) => r.rate > 0.15 || r.avg > 2500)
    .sort((a, b) => b.rate - a.rate || b.avg - a.avg)
    .slice(0, 8);
  if (!rows.length) return;
  $('r-weak').innerHTML = rows
    .map((r) => {
      const [clef, name] = r.k.split(':');
      return `<span class="chip">${clef === 'treble' ? '𝄞' : '𝄢'} ${name} · ${Math.round(r.rate * 100)}% missed${r.avg ? ` · ${(r.avg / 1000).toFixed(1)}s` : ''}</span>`;
    })
    .join(' ');
}

function startChallenge() {
  stopChallenge();
  session = { ok: 0, n: 0, streak: 0, best: 0, ms: 0 };
  challengeEnd = Date.now() + 60_000;
  challengeTimer = window.setInterval(() => {
    updateStats();
    if (Date.now() >= challengeEnd) {
      const score = session.ok;
      const isBest = score > store.reading.bestChallenge;
      if (isBest) store.reading.bestChallenge = score;
      save();
      stopChallenge();
      fb(`⏱ Time! ${score} notes correct${isBest ? ' — new record! 🎉' : ` (best: ${store.reading.bestChallenge})`}`, 'good');
      target = null;
      updateStats();
    }
  }, 250);
  void next();
  fb('Go! As many as you can in 60 seconds.');
}

function stopChallenge() {
  clearInterval(challengeTimer);
  challengeEnd = 0;
}

const stat = (v: string, k: string) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
