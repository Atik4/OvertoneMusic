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

// Tablet mode: big touch-friendly controls and sheet, the screen kept awake, pedal support.
// On by default on touch screens; the header button switches it either way.
const tabletBtn = document.getElementById('tablet-toggle')!;
let wakeLock: WakeLockSentinel | null = null;
async function keepAwake(on: boolean) {
  if (!on) return void (await wakeLock?.release(), (wakeLock = null));
  if (wakeLock || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  wakeLock = await navigator.wakeLock.request('screen').catch(() => null);
  wakeLock?.addEventListener('release', () => (wakeLock = null));
}
function applyTablet() {
  const on = store.settings.tablet ?? matchMedia('(pointer: coarse)').matches;
  document.body.classList.toggle('tablet', on);
  tabletBtn.classList.toggle('on', on);
  tabletBtn.title = on ? 'Tablet mode is on (screen stays awake). Click to turn off.' : 'Tablet mode: bigger controls and music, screen stays awake';
  void keepAwake(on);
  practice.relayout();
}
tabletBtn.onclick = () => {
  store.settings.tablet = !document.body.classList.contains('tablet');
  save();
  applyTablet();
  tabletBtn.blur();
};
// The screen lock is dropped when the page is hidden; take it again on return.
document.addEventListener('visibilitychange', () => void keepAwake(document.body.classList.contains('tablet')));
applyTablet();

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
