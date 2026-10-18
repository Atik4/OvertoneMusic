import { synth } from './synth';
import { kbd } from './keyboard';
import type { NoteEvt } from './input';
import { store, save } from './storage';
import { midiToName, pc, pick, randInt, weightedPick } from './music';

type Exercise = 'interval' | 'chord' | 'echo';

const INTERVALS = [
  { s: 1, name: 'Minor 2nd', song: 'Jaws theme' },
  { s: 2, name: 'Major 2nd', song: 'Happy Birthday' },
  { s: 3, name: 'Minor 3rd', song: 'Greensleeves' },
  { s: 4, name: 'Major 3rd', song: 'When the Saints Go Marching In' },
  { s: 5, name: 'Perfect 4th', song: 'Here Comes the Bride' },
  { s: 6, name: 'Tritone', song: 'The Simpsons theme' },
  { s: 7, name: 'Perfect 5th', song: 'Twinkle Twinkle (twin-kle → twin-kle)' },
  { s: 8, name: 'Minor 6th', song: 'The Entertainer (3rd → 4th note)' },
  { s: 9, name: 'Major 6th', song: 'My Bonnie Lies Over the Ocean' },
  { s: 10, name: 'Minor 7th', song: 'Star Trek theme (original)' },
  { s: 11, name: 'Major 7th', song: 'Take On Me (chorus)' },
  { s: 12, name: 'Octave', song: 'Somewhere Over the Rainbow' },
];
const INTERVAL_LEVELS: Record<string, number[]> = { '1': [4, 7, 12], '2': [2, 3, 4, 5, 7, 12], '3': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] };

const CHORDS = [
  { name: 'Major', iv: [0, 4, 7], feel: 'bright, happy, stable' },
  { name: 'Minor', iv: [0, 3, 7], feel: 'sad, dark' },
  { name: 'Diminished', iv: [0, 3, 6], feel: 'tense, spooky' },
  { name: 'Augmented', iv: [0, 4, 8], feel: 'dreamy, unresolved' },
  { name: 'Dominant 7th', iv: [0, 4, 7, 10], feel: 'bluesy, wants to resolve' },
  { name: 'Major 7th', iv: [0, 4, 7, 11], feel: 'soft, jazzy' },
  { name: 'Minor 7th', iv: [0, 3, 7, 10], feel: 'mellow, smooth' },
];
const CHORD_LEVELS: Record<string, string[]> = {
  '1': ['Major', 'Minor'],
  '2': ['Major', 'Minor', 'Diminished', 'Augmented'],
  '3': CHORDS.map((c) => c.name),
};

const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];

interface Question {
  answer: string;
  notes: number[];
  play: () => void;
  answered: boolean;
  pos: number;
}

let root: HTMLElement;
let ex: Exercise = 'interval';
let q: Question | null = null;
let echoLen = 1;
let echoStreak = 0;
let echoFails = 0;
let session = { ok: 0, n: 0, streak: 0 };
let nextTimer: number | undefined;
let listenAt = 0;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
const opt = (id: string) => root.querySelector<HTMLSelectElement>('#' + id)?.value ?? '';
const checked = (id: string) => !!root.querySelector<HTMLInputElement>('#' + id)?.checked;

export function init(el: HTMLElement) {
  root = el;
  el.innerHTML = `
  <div class="panel row subtabs">
    <button data-ex="interval" class="active">Intervals</button>
    <button data-ex="chord">Chords</button>
    <button data-ex="echo">Play it back</button>
  </div>
  <div class="panel row" id="e-opts"></div>
  <div class="panel">
    <div class="row">
      <button class="primary" id="e-play">▶ Play</button>
      <button id="e-next">Next ⏭</button>
      <div class="feedback" id="e-fb"></div>
    </div>
    <div class="answers" id="e-ans"></div>
    <div class="stats" id="e-stats"></div>
    <p class="muted" id="e-tip"></p>
  </div>`;
  root.querySelectorAll<HTMLButtonElement>('[data-ex]').forEach((b) => {
    b.onclick = () => {
      root.querySelectorAll('[data-ex]').forEach((x) => x.classList.toggle('active', x === b));
      ex = b.dataset.ex as Exercise;
      session = { ok: 0, n: 0, streak: 0 };
      renderOptions();
      newQuestion(false);
    };
  });
  $('e-play').onclick = () => q?.play();
  $('e-next').onclick = () => newQuestion(true);
  renderOptions();
}

export function show() {
  if (!q) newQuestion(false);
}

export function hide() {
  clearTimeout(nextTimer);
  kbd.clear('hint');
}

function renderOptions() {
  const o = $('e-opts');
  if (ex === 'interval') {
    o.innerHTML = `
      <label class="field">Level <select id="e-level"><option value="1">1 · 3rd, 5th, octave</option><option value="2">2 · + 2nds, 4th</option><option value="3">3 · all intervals</option></select></label>
      <label class="field">Direction <select id="e-dir"><option value="up">Going up</option><option value="down">Going down</option><option value="harm">Together</option><option value="mix">Mixed</option></select></label>`;
    $('e-tip').textContent = 'Tip: link each interval to the start of a song you know. The song hints appear when you get one wrong.';
  } else if (ex === 'chord') {
    o.innerHTML = `
      <label class="field">Level <select id="e-level"><option value="1">1 · major vs minor</option><option value="2">2 · + diminished, augmented</option><option value="3">3 · + 7th chords</option></select></label>
      <label class="field">Play as <select id="e-style"><option value="both">Block, then broken</option><option value="block">Block</option><option value="arp">Broken (arpeggio)</option></select></label>`;
    $('e-tip').textContent = 'Tip: listen for the mood first — major sounds bright, minor sounds sad.';
  } else {
    o.innerHTML = `
      <label class="field">Notes from <select id="e-scale"><option value="major">C major (white keys)</option><option value="chrom">All 12 notes</option></select></label>
      <label class="check"><input type="checkbox" id="e-first" checked> Show me the first note</label>
      <label class="check"><input type="checkbox" id="e-oct"> Any octave counts</label>`;
    $('e-tip').textContent = 'Listen, then play the same notes back on your piano. Gets longer as you improve.';
  }
  o.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => newQuestion(false)));
  o.querySelectorAll('input').forEach((s) => s.addEventListener('change', () => newQuestion(false)));
}

function fb(text: string, cls: 'good' | 'bad' | '' = '') {
  const el = $('e-fb');
  el.textContent = text;
  el.className = 'feedback ' + (cls ? cls + '-t' : '');
}

const statKey = (name: string) => `${ex}:${name}`;
// Items you get wrong come up more.
const weight = (name: string) => {
  const s = store.ear[statKey(name)];
  return s ? 1 + 3 * (1 - s.ok / s.n) : 1.5;
};

function newQuestion(autoplay: boolean) {
  clearTimeout(nextTimer);
  kbd.clear('hint');
  fb('');
  if (ex === 'interval') q = intervalQuestion();
  else if (ex === 'chord') q = chordQuestion();
  else q = echoQuestion();
  updateStats();
  if (autoplay) q.play();
  else fb('Press ▶ Play');
}

function intervalQuestion(): Question {
  const pool = INTERVALS.filter((i) => INTERVAL_LEVELS[opt('e-level') || '1'].includes(i.s));
  const iv = weightedPick(pool, (i) => weight(i.name));
  const dirSel = opt('e-dir') || 'up';
  const dir = dirSel === 'mix' ? pick(['up', 'down', 'harm']) : dirSel;
  const root = randInt(52, 69);
  const second = dir === 'down' ? root - iv.s : root + iv.s;
  const play = () => playInterval(root, second, dir === 'harm');
  renderAnswers(pool.map((i) => i.name), iv.name, (chosen) => {
    const c = INTERVALS.find((i) => i.name === chosen)!;
    return () => playInterval(root, dir === 'down' ? root - c.s : root + c.s, dir === 'harm');
  }, () => `Think “${iv.song}”.`);
  return { answer: iv.name, notes: [root, second], play, answered: false, pos: 0 };
}

function playInterval(a: number, b: number, together: boolean) {
  synth.stopAll();
  if (together) synth.chord([a, b], 1.6);
  else {
    synth.note(a, 0.8, 0);
    synth.note(b, 1.0, 0.75);
  }
}

function chordQuestion(): Question {
  const names = CHORD_LEVELS[opt('e-level') || '1'];
  const pool = CHORDS.filter((c) => names.includes(c.name));
  const ch = weightedPick(pool, (c) => weight(c.name));
  const root = randInt(50, 64);
  const style = opt('e-style') || 'both';
  const play = (iv = ch.iv) => {
    synth.stopAll();
    const notes = iv.map((i) => root + i);
    let t = 0;
    if (style !== 'arp') {
      synth.chord(notes, 1.4, 0);
      t = 1.6;
    }
    if (style !== 'block') notes.forEach((n, i) => synth.note(n, 0.6, t + i * 0.35));
  };
  renderAnswers(pool.map((c) => c.name), ch.name, (chosen) => () => play(CHORDS.find((c) => c.name === chosen)!.iv), () => `${ch.name} sounds ${ch.feel}.`);
  return { answer: ch.name, notes: ch.iv.map((i) => root + i), play: () => play(), answered: false, pos: 0 };
}

function renderAnswers(options: string[], answer: string, compare: (chosen: string) => () => void, hint: () => string) {
  const box = $('e-ans');
  box.innerHTML = options.map((o) => `<button data-a="${o}">${o}</button>`).join('');
  box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.onclick = () => {
      if (!q || q.answered) return;
      q.answered = true;
      const chosen = b.dataset.a!;
      const ok = chosen === answer;
      record(answer, ok);
      box.querySelector<HTMLButtonElement>(`[data-a="${answer}"]`)!.classList.add('correct');
      if (ok) {
        fb(`✓ ${answer}`, 'good');
        nextTimer = window.setTimeout(() => newQuestion(true), 1300);
      } else {
        b.classList.add('wrong');
        fb(`✗ It was ${answer}. ${hint()}`, 'bad');
        const hear = document.createElement('button');
        hear.textContent = `🔊 Hear ${chosen} (your answer)`;
        hear.className = 'link';
        hear.onclick = compare(chosen);
        box.appendChild(hear);
        replaySoon(600);
      }
    };
  });
}

function echoQuestion(): Question {
  const scale = opt('e-scale') === 'chrom' ? [...Array(12).keys()] : C_MAJOR;
  const pool: number[] = [];
  for (let m = 60; m <= 72; m++) if (scale.includes(pc(m))) pool.push(m);
  const notes = [pick(pool)];
  while (notes.length < echoLen) {
    const i = pool.indexOf(notes[notes.length - 1]);
    const j = Math.min(pool.length - 1, Math.max(0, i + pick([-2, -1, 1, 2, 1, -1])));
    notes.push(pool[j]);
  }
  const answer = notes.map(midiToName).join(' ');
  $('e-ans').innerHTML = '';
  const play = () => {
    if (!q) return;
    synth.stopAll();
    q.pos = 0;
    notes.forEach((n, i) => synth.note(n, 0.55, i * 0.65));
    listenAt = performance.now() + notes.length * 650;
    if (checked('e-first')) kbd.setHints([notes[0]]);
    fb(`Listen… (${notes.length} note${notes.length > 1 ? 's' : ''})`);
    setTimeout(() => q?.notes === notes && !q.answered && fb('Your turn — play it back!'), notes.length * 650);
  };
  return { answer, notes, play, answered: false, pos: 0 };
}

export function noteOn(e: NoteEvt) {
  if (ex !== 'echo' || !q || q.answered || e.time < listenAt) return;
  const want = q.notes[q.pos];
  const ok = checked('e-oct') ? pc(e.midi) === pc(want) : e.midi === want;
  if (ok) {
    kbd.flash(e.midi, 'good');
    kbd.clear('hint');
    q.pos++;
    if (q.pos < q.notes.length) return;
    q.answered = true;
    record(`len${q.notes.length}`, true);
    echoFails = 0;
    if (++echoStreak >= 3 && echoLen < 8) {
      echoLen++;
      echoStreak = 0;
      fb(`✓ ${q.answer} — level up! Now ${echoLen} notes.`, 'good');
    } else fb(`✓ ${q.answer}`, 'good');
    nextTimer = window.setTimeout(() => newQuestion(true), 1400);
  } else {
    kbd.flash(e.midi, 'bad');
    record(`len${q.notes.length}`, false);
    echoStreak = 0;
    if (++echoFails >= 2 && echoLen > 1) {
      echoLen--;
      echoFails = 0;
    }
    fb(`✗ You played ${midiToName(e.midi)}, the note was ${midiToName(want)}. The tune: ${q.answer}. Listen again…`, 'bad');
    q.pos = 0;
    listenAt = Infinity;
    replaySoon(1200);
  }
}

/** Replay the current question later, unless the user has moved on by then. */
function replaySoon(ms: number) {
  const asked = q;
  setTimeout(() => q === asked && q?.play(), ms);
}

function record(name: string, ok: boolean) {
  const s = (store.ear[statKey(name)] ??= { ok: 0, n: 0 });
  s.n++;
  if (ok) s.ok++;
  session.n++;
  if (ok) {
    session.ok++;
    session.streak++;
  } else session.streak = 0;
  save();
  updateStats();
}

function updateStats() {
  let html = stat(`${session.ok}/${session.n}`, 'correct') + stat(String(session.streak), 'streak');
  if (ex === 'echo') html += stat(String(echoLen), 'notes long');
  $('e-stats').innerHTML = html;
}

const stat = (v: string, k: string) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
