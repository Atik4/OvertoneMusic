/**
 * Easier left hand: rewrites staff 2 of a MusicXML score, leaving the melody (staff 1) untouched.
 *
 *   chords: every half bar (whole bar in 3/4), the left-hand notes become one held chord:
 *           the lowest note plus up to two other notes of the harmony (3rd, 5th first), closed up within an octave.
 *           If the next half bar uses the same harmony, the chord is just held.
 *   bass:   the same, but only the lowest note of each chord.
 *
 * The old left-hand notes are swapped for <forward> so nothing else in the bar moves
 * (clef changes, dynamics and the right hand keep their places); the new notes are appended in their own voice.
 */
export type LeftHand = 'written' | 'chords' | 'bass';

interface LhNote { start: number; dur: number; midi: number; pitch: Element | null }

const STEP_SEMIS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Note values we can write, in quarter notes, largest first: [quarters, type, dots]. */
const VALUES: [number, string, number][] = [
  [4, 'whole', 0], [3, 'half', 1], [2, 'half', 0], [1.5, 'quarter', 1], [1, 'quarter', 0],
  [0.75, 'eighth', 1], [0.5, 'eighth', 0], [0.25, '16th', 0],
];
const VOICE = '9';

const kids = (el: Element, tag: string) => [...el.children].filter((c) => c.tagName === tag);
const kid = (el: Element, tag: string) => kids(el, tag)[0];
const num = (el: Element | undefined, fallback = 0) => (el ? Number(el.textContent) : fallback);

function midiOf(pitch: Element) {
  const octave = num(kid(pitch, 'octave'));
  return (octave + 1) * 12 + STEP_SEMIS[kid(pitch, 'step')?.textContent ?? 'C'] + num(kid(pitch, 'alter'));
}

/** Can this text be simplified? (.mxl uploads are zipped, so not without unpacking.) */
export const canSimplify = (xml: string) => xml.trimStart().startsWith('<');

export function simplifyLeftHand(xml: string, mode: LeftHand): string {
  if (mode === 'written' || !canSimplify(xml)) return xml;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return xml;
  for (const part of doc.querySelectorAll('part')) {
    let divisions = 1, beats = 4, beatType = 4, staves = 1;
    for (const measure of kids(part, 'measure')) {
      for (const attrs of kids(measure, 'attributes')) {
        divisions = num(kid(attrs, 'divisions'), divisions);
        staves = num(kid(attrs, 'staves'), staves);
        const time = kid(attrs, 'time');
        if (time) [beats, beatType] = [num(kid(time, 'beats'), beats), num(kid(time, 'beat-type'), beatType)];
      }
      if (staves >= 2) simplifyMeasure(doc, measure, mode, divisions, beats, beatType);
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

function simplifyMeasure(doc: Document, measure: Element, mode: LeftHand, divisions: number, beats: number, beatType: number) {
  // Walk the bar to find where each left-hand note starts.
  const lh: LhNote[] = [];
  const old: Element[] = [];
  let pos = 0, last = 0, end = 0;
  for (const el of [...measure.children]) {
    if (el.tagName === 'note') {
      const grace = !!kid(el, 'grace');
      const dur = grace ? 0 : num(kid(el, 'duration'));
      const start = kid(el, 'chord') ? last : pos;
      if (!kid(el, 'chord') && !grace) (last = pos), (pos += dur);
      if (kid(el, 'staff')?.textContent === '2') {
        old.push(el);
        const pitch = kid(el, 'pitch') ?? null;
        if (pitch && !grace) lh.push({ start, dur, midi: midiOf(pitch), pitch });
      }
    } else if (el.tagName === 'backup') pos -= num(kid(el, 'duration'));
    else if (el.tagName === 'forward') pos += num(kid(el, 'duration'));
    end = Math.max(end, pos);
  }
  if (!old.length) return;

  const nominal = (divisions * 4 * beats) / beatType;
  const barLen = measure.getAttribute('implicit') === 'yes' ? end : nominal;
  const seg = beats % 2 === 0 ? nominal / 2 : nominal;

  // One held chord per segment. Same harmony as before, or nothing new, keeps the previous one ringing.
  const out: { dur: number; notes: LhNote[] }[] = [];
  const pcs = (notes: LhNote[]) => new Set(notes.map((n) => n.midi % 12));
  for (let s = 0; s < barLen; s += seg) {
    const e = Math.min(s + seg, barLen);
    const onsets = lh.filter((n) => n.start >= s && n.start < e);
    const prev = out[out.length - 1];
    const chord = onsets.length ? pick(onsets) : [];
    const sameHarmony = prev?.notes.length && chord.length && [...pcs(chord)].every((pc) => pcs(prev.notes).has(pc));
    const stillRinging = !chord.length && (prev ? !prev.notes.length || lh.some((n) => n.start < s && n.start + n.dur > s) : false);
    if (prev && (sameHarmony || stillRinging)) prev.dur += e - s;
    else out.push({ dur: e - s, notes: chord });
  }
  if (mode === 'bass') for (const o of out) o.notes = o.notes.slice(0, 1);

  // Swap the old notes for spacers so the rest of the bar keeps its timing.
  for (const el of old) {
    if (!kid(el, 'chord') && !kid(el, 'grace')) el.replaceWith(spacer(doc, 'forward', num(kid(el, 'duration'))));
    else el.remove();
  }
  const anchor = kids(measure, 'barline').find((b) => b.getAttribute('location') !== 'left') ?? null;
  const add = (el: Element) => measure.insertBefore(el, anchor);
  if (pos > 0) add(spacer(doc, 'backup', pos));
  for (const o of out) writeNotes(doc, add, o.notes, o.dur / divisions, divisions);
  if (barLen < pos) add(spacer(doc, 'forward', pos - barLen));
}

/** Intervals above the bass, most useful first: 3rds, 5th, 6ths, 7ths, 4th. Seconds and the tritone are left out. */
const PREFER = [4, 3, 7, 9, 8, 10, 11, 5];

/** A segment's chord: the lowest note plus up to two harmony notes, closed up into the octave above it. */
function pick(onsets: LhNote[]): LhNote[] {
  const bass = onsets.reduce((a, b) => (b.midi < a.midi ? b : a));
  const byInterval = new Map<number, LhNote>();
  for (const n of onsets) {
    const up = (((n.midi - bass.midi) % 12) + 12) % 12;
    if (up && !byInterval.has(up)) byInterval.set(up, n);
  }
  const chord = [bass];
  for (const up of PREFER) {
    const n = byInterval.get(up);
    if (!n || chord.length === 3 || chord.some((c) => Math.abs(c.midi - (bass.midi + up)) <= 2)) continue;
    // C3 G3 C4 E4 becomes C3 E3 G3.
    chord.push({ ...n, midi: bass.midi + up, pitch: shiftOctave(n.pitch!, Math.round((bass.midi + up - n.midi) / 12)) });
  }
  return chord.sort((a, b) => a.midi - b.midi);
}

function shiftOctave(pitch: Element, octaves: number): Element {
  const p = pitch.cloneNode(true) as Element;
  const o = kid(p, 'octave');
  o.textContent = String(num(o) + octaves);
  return p;
}

function spacer(doc: Document, tag: 'forward' | 'backup', duration: number) {
  const el = doc.createElement(tag);
  el.appendChild(doc.createElement('duration')).textContent = String(duration);
  return el;
}

/** Write a held chord (or rest) of `quarters`, split into tied note values if one value can't hold it. */
function writeNotes(doc: Document, add: (el: Element) => void, notes: LhNote[], quarters: number, divisions: number) {
  const parts: (typeof VALUES)[number][] = [];
  let left = quarters;
  while (left > 1e-6) {
    const v = VALUES.find(([q]) => q <= left + 1e-6 && Number.isInteger(Math.round(q * divisions * 1000) / 1000));
    if (!v) break;
    parts.push(v);
    left -= v[0];
  }
  parts.forEach(([q, type, dots], i) => {
    const tieStart = notes.length > 0 && i < parts.length - 1;
    const tieStop = notes.length > 0 && i > 0;
    (notes.length ? notes : [null]).forEach((n, j) => {
      const el = doc.createElement('note');
      if (j > 0) el.appendChild(doc.createElement('chord'));
      el.appendChild(n ? n.pitch!.cloneNode(true) : doc.createElement('rest'));
      el.appendChild(doc.createElement('duration')).textContent = String(Math.round(q * divisions));
      if (tieStop) el.appendChild(doc.createElement('tie')).setAttribute('type', 'stop');
      if (tieStart) el.appendChild(doc.createElement('tie')).setAttribute('type', 'start');
      el.appendChild(doc.createElement('voice')).textContent = VOICE;
      el.appendChild(doc.createElement('type')).textContent = type;
      for (let d = 0; d < dots; d++) el.appendChild(doc.createElement('dot'));
      el.appendChild(doc.createElement('staff')).textContent = '2';
      if (tieStart || tieStop) {
        const nt = el.appendChild(doc.createElement('notations'));
        if (tieStop) nt.appendChild(doc.createElement('tied')).setAttribute('type', 'stop');
        if (tieStart) nt.appendChild(doc.createElement('tied')).setAttribute('type', 'start');
      }
      add(el);
    });
  });
}
