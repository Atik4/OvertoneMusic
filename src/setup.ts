import { input, type NoteEvt } from './input';
import { synth } from './synth';
import { kbd } from './keyboard';
import { store, save, resetProgress, streakInfo } from './storage';
import { midiToName } from './music';

let root: HTMLElement;
let raf = 0;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;

const RANGES: Record<string, string> = { '48-84': '37 keys (C3–C6)', '36-96': '61 keys (C2–C7)', '21-108': '88 keys (full piano)' };

export function applySettings() {
  document.body.classList.toggle('kbd-hidden', !store.settings.showKbd);
  const toggle = document.getElementById('kbd-toggle');
  if (toggle) toggle.textContent = store.settings.showKbd ? '▾ Hide keyboard' : '🎹 Show keyboard';
  const box = document.getElementById('s-showkbd') as HTMLInputElement | null;
  if (box) box.checked = store.settings.showKbd;
  const [lo, hi] = store.settings.kbdRange.split('-').map(Number);
  kbd.setRange(lo, hi);
  kbd.setShowNames(store.settings.showNames);
  synth.setVolume(store.settings.volume);
}

export function init(el: HTMLElement) {
  root = el;
  const s = store.settings;
  el.innerHTML = `
  <div class="panel">
    <h3>1 · Connect your piano</h3>
    <p><b>Best:</b> a digital piano or keyboard with a USB (MIDI) cable. Notes are detected instantly and exactly, chords included. Works in Chrome or Edge.</p>
    <div class="row"><button class="primary" id="s-midi">🎹 Connect MIDI keyboard</button><span id="s-midi-st" class="muted"></span></div>
    <h3>Or use the microphone</h3>
    <p>For acoustic pianos. It hears one note at a time, so for chords any one of the chord's notes counts. A quiet room helps.</p>
    <div class="row"><button id="s-mic">🎤 Turn on microphone</button><span id="s-mic-st" class="muted"></span></div>
    <div class="row">
      <div class="meter"><div id="s-meter"></div><i id="s-gate-mark"></i></div>
      <span>Heard: <b id="s-heard" class="big">—</b></span>
    </div>
    <label class="field">Noise gate: raise it if the app “hears” notes you didn't play, lower it if it misses soft notes
      <input type="range" id="s-gate" min="0.002" max="0.06" step="0.001" value="${s.micGate}"></label>
    <label class="field">Mic delay compensation: <span id="s-lat-v">${s.micLatency} ms</span>
      <input type="range" id="s-lat" min="0" max="200" step="5" value="${s.micLatency}"></label>
    <h3>No piano nearby?</h3>
    <p>Click the keys at the bottom, or use your computer keyboard: <kbd>A</kbd><kbd>W</kbd><kbd>S</kbd><kbd>E</kbd><kbd>D</kbd><kbd>F</kbd><kbd>T</kbd><kbd>G</kbd><kbd>Y</kbd><kbd>H</kbd><kbd>U</kbd><kbd>J</kbd><kbd>K</kbd> = C4 to C5. <kbd>Z</kbd>/<kbd>X</kbd> move an octave down/up.</p>
  </div>
  <div class="panel">
    <h3>Display &amp; sound</h3>
    <div class="row">
      <label class="field">On-screen keyboard <select id="s-range">${Object.entries(RANGES).map(([v, l]) => `<option value="${v}" ${v === s.kbdRange ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="s-showkbd" ${s.showKbd ? 'checked' : ''}> Show on-screen keyboard</label>
      <label class="check"><input type="checkbox" id="s-names" ${s.showNames ? 'checked' : ''}> Show note names on every key</label>
      <label class="field">Volume <input type="range" id="s-vol" min="0" max="1" step="0.05" value="${s.volume}"></label>
      <button id="s-test">🔊 Test sound</button>
    </div>
  </div>
  <div class="panel">
    <h3>Your progress</h3>
    <div id="s-progress"></div>
    <p class="muted">Progress is saved in this browser only.</p>
    <button id="s-reset">Reset all progress</button>
  </div>`;

  $('s-midi').onclick = async () => {
    try {
      await input.enableMidi();
    } catch {
      /* status shown via onStatus */
    }
  };
  $('s-mic').onclick = async () => {
    try {
      await input.enableMic();
    } catch (err) {
      $('s-mic-st').textContent = `Microphone blocked: ${(err as Error).message}`;
    }
  };
  $<HTMLInputElement>('s-gate').oninput = (e) => {
    s.micGate = Number((e.target as HTMLInputElement).value);
    save();
  };
  $<HTMLInputElement>('s-lat').oninput = (e) => {
    s.micLatency = Number((e.target as HTMLInputElement).value);
    $('s-lat-v').textContent = `${s.micLatency} ms`;
    save();
  };
  $<HTMLSelectElement>('s-range').onchange = (e) => {
    s.kbdRange = (e.target as HTMLSelectElement).value;
    save();
    applySettings();
  };
  $<HTMLInputElement>('s-showkbd').onchange = (e) => {
    s.showKbd = (e.target as HTMLInputElement).checked;
    save();
    applySettings();
  };
  $<HTMLInputElement>('s-names').onchange = (e) => {
    s.showNames = (e.target as HTMLInputElement).checked;
    save();
    applySettings();
  };
  $<HTMLInputElement>('s-vol').oninput = (e) => {
    s.volume = Number((e.target as HTMLInputElement).value);
    save();
    applySettings();
  };
  $('s-test').onclick = () => [60, 64, 67, 72].forEach((m, i) => synth.note(m, 0.5, i * 0.18));
  $('s-reset').onclick = () => {
    if (confirm('Erase all saved progress (speeds, scores, streaks)? Uploaded music is kept.')) {
      resetProgress();
      renderProgress();
    }
  };
  input.onStatus(renderStatus);
  renderStatus();
}

function renderStatus() {
  if (!root) return;
  $('s-midi-st').textContent = input.midiError || (input.midiDevices.length ? `Connected: ${input.midiDevices.join(', ')}` : store.settings.midiEnabled ? 'No MIDI keyboard found — plug it in and it will appear.' : '');
  $('s-mic-st').textContent = input.micOn ? 'Listening.' : '';
}

function renderProgress() {
  const { streak, minutesToday } = streakInfo();
  const pieces = Object.keys(store.pieces).length;
  const reading = Object.values(store.reading.notes).reduce((a, s) => a + s.ok, 0);
  const ear = Object.values(store.ear).reduce((a, s) => a + s.ok, 0);
  $('s-progress').innerHTML = `<div class="stats">
    ${stat(`${streak}`, 'day streak')}${stat(`${minutesToday}`, 'minutes today')}${stat(`${pieces}`, 'pieces practised')}
    ${stat(`${reading}`, 'notes read')}${stat(`${ear}`, 'ear answers right')}${stat(`${store.reading.bestChallenge}`, '60s challenge best')}</div>`;
}

export function show() {
  renderProgress();
  const tick = () => {
    const lvl = Math.min(1, input.micLevel / 0.1);
    $('s-meter').style.width = `${lvl * 100}%`;
    $('s-gate-mark').style.left = `${Math.min(1, store.settings.micGate / 0.1) * 100}%`;
    raf = requestAnimationFrame(tick);
  };
  tick();
}

export function hide() {
  cancelAnimationFrame(raf);
}

export function noteOn(e: NoteEvt) {
  $('s-heard').textContent = midiToName(e.midi);
}

const stat = (v: string, k: string) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
