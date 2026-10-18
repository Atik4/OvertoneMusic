# 🎹 Piano Coach

A free, local piano-learning app: read sheet music, practise with instant note detection, build speed gradually, and train your ear.

## Run it

```bash
npm install     # first time only
npm run dev     # opens http://localhost:5173
```

Use **Chrome or Edge** (Safari has no Web MIDI). Everything stays in your browser. Progress is saved in localStorage.

## Connect your piano (Setup tab)

- **Digital piano / keyboard with USB:** plug it in and click *Connect MIDI keyboard*. Detection is instant and exact, chords included.
- **Acoustic piano:** click *Turn on microphone*. It hears one note at a time, so for chords any one of the chord's notes counts. Adjust the noise gate if it hears phantom notes or misses soft ones.
- **Hide the on-screen keyboard** with the button at its top-right, and turn off *Show keys* in Practice, so you read only from the music.
- **No piano:** click the on-screen keys, or use the computer keys `A W S E D F T G Y H U J K` (C4–C5), with `Z`/`X` to change octave.

## What's inside

| Tab | What it does |
|---|---|
| **Practice** | Sheet music with a moving cursor. **Wait for me** mode waits until you play the right note(s). **Play along** mode keeps the beat, with a count-in and metronome, and scores you on timing (early/late in ms). Choose right hand, left hand or both (it can play the other hand for you). You can loop any bars. The **speed trainer** starts slow and raises the tempo after each run of 90% or better, until your target. Results point out your tough bars. **Show: one bar / one note at a time** hides the notes you haven't reached, so you have to read them (in Play along you see one note or bar ahead). **Key** transposes the piece up or down to 6 semitones: the sheet music, the notes it listens for and the Player all change at once, and the choice is remembered per piece. **Click any note** on the sheet to start from there: Start practises from that note and ▶ Play plays from it (clicking while it plays jumps there). **Left hand: Easier / Easiest** swaps the left hand for held block chords or single bass notes (one per half bar, held while the harmony stays the same); the melody is untouched. |
| **Practice → Player** | Hear how the piece should sound before you play it, like MuseScore's player: play/pause, jump to any bar, change the tempo while it plays, loop bars, hear one hand alone, metronome and count-in. The cursor follows the music. |
| **Note Reading** | Flash-card notes on treble/bass staff, with ledger lines and sharps/flats as options. Notes you miss come up more often. There's also a 60-second challenge. |
| **Note Reading → Note stream** | An endless stream of random notes scrolls toward a play line, so there is nothing to memorise. **Wait for me** moves on only when you play the right note and tracks your reading speed (notes/min). **Keep moving** sends notes at a steady speed and speeds up after every 16 notes played with 90% or better. You can look ahead 1–10 notes, use treble, bass or the grand staff, and choose step-wise melodies or random jumps. |
| **Ear Training** | Intervals (with song hints), chord qualities, and *Play it back*: hear a short melody and play it on your piano. The melody gets longer as you improve. |

## Your own music

Click **Open MusicXML…** on the Practice tab to load `.musicxml`, `.xml` or `.mxl` files. Free sources: [MuseScore](https://musescore.com) (export as MusicXML), [IMSLP](https://imslp.org), [Mutopia](https://www.mutopiaproject.org).

**From a printed book or PDF:** in [MuseScore 4](https://musescore.org) (free), use *File → Import PDF*, fix any notes it misread, then *File → Export → MusicXML* and open that file here. Only do this with music you're allowed to copy for your own practice.

To add built-in lessons, edit `src/pieces.ts`. The notation is simple text, e.g. `"E4q D4q C4q D4q | E4q E4q E4h"`; see `src/score.ts`. A lesson can also point to a MusicXML file in `public/` (`file: 'grade1/A1.musicxml'`).

### ABRSM Grade 1 pieces

The *ABRSM Grade 1* group in the piece list holds the nine exam pieces (A1–C3), converted from a scan of the book with [Audiveris](https://github.com/Audiveris/audiveris) and then checked against the scan bar by bar. The files live in `public/grade1/`, which is git-ignored because the music is copyrighted: keep them for your own practice.

Songs you add the same way go in `public/songs/` (also git-ignored), listed under *My songs*: Raabta is there now.

To convert another scanned book the same way, run `Audiveris -batch -transcribe -export -output <folder> book.pdf` (the app is in `/Applications/Audiveris.app/Contents/MacOS/`). Pages with no music make the export fail, so pass `-sheets 5-13` (or whichever pages have music). Then check every piece against the book: Audiveris often drops whole notes, misreads triplets and reads slurs as ties.

## Hosting it (Vercel)

It's a static site: Vercel detects Vite, runs `npm run build` and serves `dist/`. Push this repo to GitHub, then *Add New → Project* in Vercel and import it; no settings needed. HTTPS (which Vercel gives you) is required for the microphone and MIDI.

The Grade 1 pieces and *My songs* are copyrighted, so `public/grade1/` and `public/songs/` are git-ignored and are **not** deployed. The app simply leaves pieces it can't find out of the list, so the hosted version has the built-in lessons, and you can still open your own MusicXML there (it's saved in that browser only).

## Code map

- `src/input.ts`: MIDI, microphone (YIN pitch detection in `pitch.ts`), computer keys
- `src/practice.ts`: sheet music practice, timing judge, speed trainer
- `src/player.ts`: the Player (listen to the piece)
- `src/reading.ts`, `src/stream.ts`, `src/ear.ts`: drills
- `src/pieces.ts`, `src/score.ts`: built-in lessons and their text notation
- `src/simplify.ts`: the easier left-hand versions
- `src/synth.ts`: piano sound (Salamander samples, with a small synth while they load) and metronome
- `src/keyboard.ts`: on-screen keyboard
- `src/setup.ts`, `src/storage.ts`: Setup tab, saved progress and settings

## Credits

Piano sound: [Salamander Grand Piano V3](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm, licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) (files in `public/piano/`, from the `@audio-samples/piano-mp3-velocity8` package). Sheet music rendering: [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org).
