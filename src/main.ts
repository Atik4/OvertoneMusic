import './style.css';
import { input, type NoteEvt } from './input';
import { synth } from './synth';
import { kbd } from './keyboard';
import { store, save, recordActivity, streakInfo } from './storage';
import { midiToName } from './music';
import * as practice from './practice';
import * as reading from './reading';
import * as ear from './ear';
import * as setup from './setup';

interface TabModule {
  init(el: HTMLElement): void;
  show?(): void;
  hide?(): void;
  noteOn?(e: NoteEvt): void;
}

const tabs: Record<string, TabModule> = { practice, reading, ear, setup };
let active = 'practice';

kbd.mount(document.getElementById('kbd')!);
setup.applySettings();
for (const [name, mod] of Object.entries(tabs)) mod.init(document.getElementById(`tab-${name}`)!);

function switchTab(name: string) {
  if (name === active) return;
  tabs[active].hide?.();
  kbd.clear('hint');
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  active = name;
  tabs[name].show?.();
}
document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab!)));
// After picking from a dropdown, give the keyboard back so Space and the computer-key piano work.
document.addEventListener('change', (e) => {
  if (e.target instanceof HTMLSelectElement) e.target.blur();
});

// The on-screen keyboard can be hidden, e.g. when reading from the music with a real piano.
const kbdToggle = document.getElementById('kbd-toggle')!;
kbdToggle.onclick = () => {
  store.settings.showKbd = !store.settings.showKbd;
  save();
  setup.applySettings();
  kbdToggle.blur();
};

const ICON = { midi: '🎹', mic: '🎤', keys: '⌨️', screen: '🖱️' } as const;
const heard = document.getElementById('st-heard')!;
input.onNoteOn((e) => {
  heard.textContent = `${ICON[e.source]} ${midiToName(e.midi)}`;
  recordActivity();
  tabs[active].noteOn?.(e);
  if (active !== 'setup') setup.noteOn(e);
});

function renderStatus() {
  const parts: string[] = [];
  if (input.midiDevices.length) parts.push(`🎹 ${input.midiDevices[0]}`);
  if (input.micOn) parts.push('🎤 Mic on');
  document.getElementById('st-input')!.textContent = parts.join(' · ') || '⌨️ Computer keys — connect a piano in Setup';
  const { streak, minutesToday } = streakInfo();
  document.getElementById('st-streak')!.textContent = `🔥 ${streak} day${streak === 1 ? '' : 's'} · ${minutesToday} min today`;
}
input.onStatus(renderStatus);
renderStatus();
setInterval(renderStatus, 30_000);

// Browsers only allow sound after a click or key press.
const banner = document.getElementById('audio-banner')!;
const unlock = () => {
  synth.audio;
  banner.classList.add('hidden');
};
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

// Reconnect what worked last time.
if (store.settings.midiEnabled) input.enableMidi().catch(() => {});
if (store.settings.micEnabled) {
  input.enableMic().then(() => !synth.running && banner.classList.remove('hidden')).catch(() => {});
}

tabs[active].show?.();
