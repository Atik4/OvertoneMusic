import type { ScoreSpec } from './score';

export interface Piece {
  id: string;
  level: string;
  /** Written in the text notation of score.ts... */
  spec?: ScoreSpec;
  /** ...or a MusicXML file under public/, shown in the list as `title`. */
  file?: string;
  title?: string;
}

export const pieceTitle = (p: Piece) => p.title ?? p.spec?.title ?? p.id;

// All public-domain melodies, simplified for learning. Notation is documented in score.ts.
export const PIECES: Piece[] = [
  {
    id: 'five-finger',
    level: 'Beginner',
    spec: {
      title: 'Five-Finger Warm-up (C position)',
      tempo: 80,
      rh: 'C4q D4q E4q F4q | G4q F4q E4q D4q | C4q E4q G4q E4q | C4w',
      lh: 'C3q D3q E3q F3q | G3q F3q E3q D3q | C3q E3q G3q E3q | C3w',
    },
  },
  {
    id: 'c-scale',
    level: 'Beginner',
    spec: {
      title: 'C Major Scale',
      tempo: 80,
      rh: 'C4q D4q E4q F4q | G4q A4q B4q C5q | C5q B4q A4q G4q | F4q E4q D4q C4q | C4w',
      lh: 'C3q D3q E3q F3q | G3q A3q B3q C4q | C4q B3q A3q G3q | F3q E3q D3q C3q | C3w',
    },
  },
  {
    id: 'mary',
    level: 'Beginner',
    spec: {
      title: 'Mary Had a Little Lamb',
      composer: 'Traditional',
      tempo: 100,
      rh: 'E4q D4q C4q D4q | E4q E4q E4h | D4q D4q D4h | E4q G4q G4h | E4q D4q C4q D4q | E4q E4q E4q E4q | D4q D4q E4q D4q | C4w',
      lh: 'C3w | C3w | G2w | C3w | C3w | C3w | G2w | C3w',
    },
  },
  {
    id: 'twinkle',
    level: 'Beginner',
    spec: {
      title: 'Twinkle Twinkle Little Star',
      composer: 'Traditional',
      tempo: 100,
      rh: 'C4q C4q G4q G4q | A4q A4q G4h | F4q F4q E4q E4q | D4q D4q C4h | G4q G4q F4q F4q | E4q E4q D4h | G4q G4q F4q F4q | E4q E4q D4h | C4q C4q G4q G4q | A4q A4q G4h | F4q F4q E4q E4q | D4q D4q C4h',
      lh: 'C3w | F3h C3h | F3h C3h | G2h C3h | C3h F3h | C3h G2h | C3h F3h | C3h G2h | C3w | F3h C3h | F3h C3h | G2h C3h',
    },
  },
  {
    id: 'ode',
    level: 'Beginner',
    spec: {
      title: 'Ode to Joy',
      composer: 'L. van Beethoven',
      tempo: 90,
      rh: 'E4q E4q F4q G4q | G4q F4q E4q D4q | C4q C4q D4q E4q | E4q. D4e D4h | E4q E4q F4q G4q | G4q F4q E4q D4q | C4q C4q D4q E4q | D4q. C4e C4h',
      lh: 'C3w | G2w | C3w | G2w | C3w | G2w | C3w | G2h C3h',
    },
  },
  {
    id: 'jingle',
    level: 'Easy',
    spec: {
      title: 'Jingle Bells (chorus)',
      composer: 'J. Pierpont',
      tempo: 110,
      rh: 'E4q E4q E4h | E4q E4q E4h | E4q G4q C4q. D4e | E4w | F4q F4q F4q. F4e | F4q E4q E4q E4e E4e | E4q D4q D4q E4q | D4h G4h | E4q E4q E4h | E4q E4q E4h | E4q G4q C4q. D4e | E4w | F4q F4q F4q. F4e | F4q E4q E4q E4e E4e | G4q G4q F4q D4q | C4w',
      lh: 'C3w | C3w | C3w | C3w | F2w | C3w | G2w | G2w | C3w | C3w | C3w | C3w | F2w | C3w | G2w | C3w',
    },
  },
  {
    id: 'chords',
    level: 'Easy',
    spec: {
      title: 'First Chords: C – F – G – C',
      tempo: 70,
      rh: 'C4+E4+G4h C4+E4+G4h | C4+F4+A4h C4+F4+A4h | B3+D4+G4h B3+D4+G4h | C4+E4+G4w',
      lh: 'C3h C3h | F2h F2h | G2h G2h | C3w',
    },
  },
  {
    id: 'minuet',
    level: 'Intermediate',
    spec: {
      title: 'Minuet in G (simplified)',
      composer: 'C. Petzold',
      tempo: 100,
      time: [3, 4],
      key: 1,
      rh: 'D5q G4e A4e B4e C5e | D5q G4q G4q | E5q C5e D5e E5e F#5e | G5q G4q G4q | C5q D5e C5e B4e A4e | B4q C5e B4e A4e G4e | F#4q G4e A4e B4e G4e | A4h.',
      lh: 'G3h. | B3h. | C4h. | B3h. | A3h. | G3h. | D3h. | D3h.',
    },
  },
  // ABRSM Grade 1 exam pieces, converted from your own copy of the book with Audiveris and checked by hand.
  // They're copyrighted, so the files stay local (public/grade1/ is git-ignored).
  { id: 'g1-a1', level: 'ABRSM Grade 1', title: "A1 Fireworks Minuet", file: 'grade1/A1.musicxml' },
  { id: 'g1-a2', level: 'ABRSM Grade 1', title: "A2 Melody in F", file: 'grade1/A2.musicxml' },
  { id: 'g1-a3', level: 'ABRSM Grade 1', title: "A3 Muss i denn", file: 'grade1/A3.musicxml' },
  { id: 'g1-b1', level: 'ABRSM Grade 1', title: "B1 A Song of Erin", file: 'grade1/B1.musicxml' },
  { id: 'g1-b2', level: 'ABRSM Grade 1', title: "B2 Remember Me", file: 'grade1/B2.musicxml' },
  { id: 'g1-b3', level: 'ABRSM Grade 1', title: "B3 Winter", file: 'grade1/B3.musicxml' },
  { id: 'g1-c1', level: 'ABRSM Grade 1', title: "C1 Cyberspace Detective", file: 'grade1/C1.musicxml' },
  { id: 'g1-c2', level: 'ABRSM Grade 1', title: "C2 The Wind", file: 'grade1/C2.musicxml' },
  { id: 'g1-c3', level: 'ABRSM Grade 1', title: "C3 Berry's Smoothie", file: 'grade1/C3.musicxml' },
  // Songs from sheet music screenshots (Audiveris, or typed in by hand), checked against the sheet. Also local only.
  { id: 'song-raabta', level: 'My songs', title: 'Raabta (Agent Vinod)', file: 'songs/raabta.musicxml' },
  { id: 'song-tumhi-dekho-na', level: 'My songs', title: 'Tumhi Dekho Na', file: 'songs/tumhi-dekho-na.musicxml' },
  { id: 'song-cant-help-falling', level: 'My songs', title: "Can't Help Falling In Love", file: 'songs/cant-help-falling-in-love.musicxml' },
  { id: 'song-all-of-me', level: 'My songs', title: 'All Of Me', file: 'songs/all-of-me.musicxml' },
  { id: 'song-let-her-go', level: 'My songs', title: 'Let Her Go', file: 'songs/let-her-go.musicxml' },
  { id: 'song-kal-ho-naa-ho', level: 'My songs', title: 'Kal Ho Naa Ho', file: 'songs/kal-ho-naa-ho.musicxml' },
];
