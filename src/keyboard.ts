import { input } from './input';
import { isBlack, midiToName } from './music';

/** On-screen piano. Shows held keys, hints, and right/wrong flashes; clickable. */
class PianoKeyboard {
  private root!: HTMLElement;
  private keys = new Map<number, HTMLElement>();
  private timers = new Map<string, number>();
  private pointers = new Map<number, number>();
  private lo = 36;
  private hi = 96;

  mount(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'piano';
    container.appendChild(this.root);
    this.render();
    input.onNoteOn((e) => this.add(e.midi, 'down'));
    input.onNoteOff((e) => this.remove(e.midi, 'down'));

    this.root.addEventListener('pointerdown', (e) => {
      const m = this.midiAt(e.clientX, e.clientY);
      if (m === null) return;
      e.preventDefault();
      this.root.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, m);
      input.noteOn(m, 0.8, 'screen');
    });
    this.root.addEventListener('pointermove', (e) => {
      const cur = this.pointers.get(e.pointerId);
      if (cur === undefined) return;
      const m = this.midiAt(e.clientX, e.clientY);
      if (m === null || m === cur) return;
      input.noteOff(cur, 'screen');
      this.pointers.set(e.pointerId, m);
      input.noteOn(m, 0.8, 'screen');
    });
    const up = (e: PointerEvent) => {
      const cur = this.pointers.get(e.pointerId);
      if (cur === undefined) return;
      this.pointers.delete(e.pointerId);
      input.noteOff(cur, 'screen');
    };
    this.root.addEventListener('pointerup', up);
    this.root.addEventListener('pointercancel', up);
  }

  private midiAt(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.key');
    return el && this.root.contains(el) ? Number(el.dataset.midi) : null;
  }

  setRange(lo: number, hi: number) {
    this.lo = lo;
    this.hi = hi;
    if (this.root) this.render();
  }

  setShowNames(on: boolean) {
    this.root.classList.toggle('names', on);
  }

  private render() {
    this.root.innerHTML = '';
    this.keys.clear();
    let whites = 0;
    for (let m = this.lo; m <= this.hi; m++) if (!isBlack(m)) whites++;
    const w = 100 / whites;
    let wi = 0;
    for (let m = this.lo; m <= this.hi; m++) {
      const k = document.createElement('div');
      k.dataset.midi = String(m);
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = midiToName(m);
      if (isBlack(m)) {
        k.className = 'key black';
        k.style.left = `${wi * w - w * 0.32}%`;
        k.style.width = `${w * 0.64}%`;
      } else {
        k.className = 'key white' + (m % 12 === 0 ? ' c' : '');
        k.style.left = `${wi * w}%`;
        k.style.width = `${w}%`;
        wi++;
      }
      k.appendChild(lbl);
      this.root.appendChild(k);
      this.keys.set(m, k);
    }
  }

  add(m: number, cls: string) {
    this.keys.get(m)?.classList.add(cls);
  }
  remove(m: number, cls: string) {
    this.keys.get(m)?.classList.remove(cls);
  }
  clear(cls: string) {
    this.root.querySelectorAll('.' + cls).forEach((e) => e.classList.remove(cls));
  }
  setHints(midis: Iterable<number>) {
    this.clear('hint');
    for (const m of midis) this.add(m, 'hint');
  }
  flash(m: number, cls: 'good' | 'bad', ms = 350) {
    const id = `${m}:${cls}`;
    clearTimeout(this.timers.get(id));
    this.remove(m, cls === 'good' ? 'bad' : 'good');
    this.add(m, cls);
    this.timers.set(id, window.setTimeout(() => this.remove(m, cls), ms));
  }
}

export const kbd = new PianoKeyboard();
