/**
 * Tiny text notation -> MusicXML, so lessons can be written by hand.
 *
 *   Token  = pitches + duration + optional dot.   Bar lines "|" are optional.
 *   Pitch  = C4, F#3, Bb5        Chord = C4+E4+G4        Rest = r
 *   Duration: w (whole) h (half) q (quarter) e (eighth) s (16th), add "." for dotted.
 *   Example: "E4q D4q C4q D4q | E4q E4q E4h"
 */
export interface ScoreSpec {
  title?: string;
  composer?: string;
  tempo?: number;
  time?: [number, number];
  /** Key signature as number of sharps (+) or flats (-). */
  key?: number;
  rh?: string;
  lh?: string;
  hideTime?: boolean;
}

interface Pitch { step: string; alter: number; octave: number }
interface Tok { pitches: Pitch[]; dur: number; type: string; dot: boolean }

const DIV = 4; // divisions per quarter note
const DUR: Record<string, [number, string]> = { w: [16, 'whole'], h: [8, 'half'], q: [4, 'quarter'], e: [2, 'eighth'], s: [1, '16th'] };

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

function parse(src: string): Tok[] {
  return src
    .split(/\s+/)
    .filter((t) => t && t !== '|')
    .map((t) => {
      const m = /^(r|[A-G][#b]?\d(?:\+[A-G][#b]?\d)*)([whqes])(\.?)$/.exec(t);
      if (!m) throw new Error(`Can't read "${t}". Use e.g. C4q, F#3h, C4+E4+G4w, rq`);
      const [base, type] = DUR[m[2]];
      const dot = m[3] === '.';
      const pitches = m[1] === 'r' ? [] : m[1].split('+').map((p) => {
        const pm = /^([A-G])([#b]?)(\d)$/.exec(p)!;
        return { step: pm[1], alter: pm[2] === '#' ? 1 : pm[2] === 'b' ? -1 : 0, octave: Number(pm[3]) };
      });
      return { pitches, dur: dot ? base * 1.5 : base, type, dot };
    });
}

function toMeasures(toks: Tok[], len: number, staffName: string): Tok[][] {
  const out: Tok[][] = [];
  let cur: Tok[] = [];
  let fill = 0;
  for (const t of toks) {
    if (fill + t.dur > len) throw new Error(`${staffName}: a note crosses the bar line in bar ${out.length + 1}`);
    cur.push(t);
    fill += t.dur;
    if (fill === len) {
      out.push(cur);
      cur = [];
      fill = 0;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

function restsFor(dur: number): Tok[] {
  const out: Tok[] = [];
  for (const k of ['w', 'h', 'q', 'e', 's']) {
    const [d, type] = DUR[k];
    while (dur >= d) {
      out.push({ pitches: [], dur: d, type, dot: false });
      dur -= d;
    }
  }
  return out;
}

function noteXml(t: Tok, staff: number, voice: number): string {
  const tail = `<duration>${t.dur}</duration><voice>${voice}</voice><type>${t.type}</type>${t.dot ? '<dot/>' : ''}<staff>${staff}</staff>`;
  if (!t.pitches.length) return `<note><rest/>${tail}</note>`;
  return t.pitches
    .map((p, i) =>
      `<note>${i ? '<chord/>' : ''}<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>${tail}</note>`)
    .join('');
}

export function toMusicXML(spec: ScoreSpec): string {
  const [beats, beatType] = spec.time ?? [4, 4];
  const len = (beats * 4 * DIV) / beatType;
  const staves = [
    spec.rh !== undefined && { measures: toMeasures(parse(spec.rh), len, 'Right hand'), clef: '<sign>G</sign><line>2</line>' },
    spec.lh !== undefined && { measures: toMeasures(parse(spec.lh), len, 'Left hand'), clef: '<sign>F</sign><line>4</line>' },
  ].filter((s): s is { measures: Tok[][]; clef: string } => !!s);
  if (!staves.length) throw new Error('Nothing to show');
  const count = Math.max(...staves.map((s) => s.measures.length));

  let body = '';
  for (let i = 0; i < count; i++) {
    body += `<measure number="${i + 1}">`;
    if (i === 0) {
      body += `<attributes><divisions>${DIV}</divisions><key><fifths>${spec.key ?? 0}</fifths></key>`;
      body += `<time${spec.hideTime ? ' print-object="no"' : ''}><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`;
      body += `<staves>${staves.length}</staves>`;
      body += staves.map((s, n) => `<clef number="${n + 1}">${s.clef}</clef>`).join('');
      body += `</attributes>`;
      if (spec.tempo) {
        body += `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${spec.tempo}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${spec.tempo}"/></direction>`;
      }
    }
    staves.forEach((s, n) => {
      if (n > 0) body += `<backup><duration>${len}</duration></backup>`;
      const toks = s.measures[i] ?? [];
      const filled = toks.reduce((a, t) => a + t.dur, 0);
      for (const t of [...toks, ...restsFor(len - filled)]) body += noteXml(t, n + 1, n === 0 ? 1 : 5);
    });
    body += `</measure>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">${spec.title ? `<movement-title>${esc(spec.title)}</movement-title>` : ''}
<identification>${spec.composer ? `<creator type="composer">${esc(spec.composer)}</creator>` : ''}</identification>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">${body}</part></score-partwise>`;
}
