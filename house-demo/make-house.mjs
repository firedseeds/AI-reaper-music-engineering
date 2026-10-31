/**
 * Arrange a ~5 minute house track from the same musical vocabulary.
 *
 * 155 bars at 124 BPM = 300 s. A section table drives which layers play, so
 * the arrangement can be long without hand-writing every bar:
 *
 *   intro 16 | drop A 32 | break 16 | drop B 32 | vocal 16 | drop C 32 | outro 11
 *
 * Outputs: one combined MIDI file, one format-0 file per instrument, and
 * timeline.json so the REAPER project builder can place samples by section.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PPQ = 480
const BPM = 124
const BEAT = 60 / BPM
const BAR = BEAT * 4
const BEATS_PER_BAR = 4

const outDir = dirname(fileURLToPath(import.meta.url))
const outFile = join(outDir, 'house-124-fmin.mid')

const T = beat => Math.round(beat * PPQ)

function vlq(value) {
  let v = Math.max(0, Math.round(value))
  const bytes = [v & 0x7f]
  v = Math.floor(v / 128)
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  return bytes
}

const u32 = n => [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const u16 = n => [(n >> 8) & 0xff, n & 0xff]
const str = s => [...Buffer.from(s, 'latin1')]
const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data]

const RANK_OFF = 0
const RANK_ON = 1
const RANK_SETUP = 2

let seq = 0
function put(events, tick, rank, bytes) {
  events.push({ tick, rank, seq: seq++, bytes })
}

function track(events) {
  events.sort((a, b) => a.tick - b.tick || a.rank - b.rank || a.seq - b.seq)
  const body = []
  let last = 0
  for (const event of events) {
    body.push(...vlq(event.tick - last), ...event.bytes)
    last = event.tick
  }
  body.push(...vlq(0), 0xff, 0x2f, 0x00)
  return [...str('MTrk'), ...u32(body.length), ...body]
}

function note(events, tick, durationTicks, pitch, velocity, channel = 0) {
  put(events, tick, RANK_ON, [0x90 | channel, pitch, velocity])
  put(events, tick + durationTicks, RANK_OFF, [0x80 | channel, pitch, 0])
}

// ------------------------------------------------------------------ the song

/**
 * Section table. `kind` drives the layer rules; `lead` picks a melody set for
 * the drops. Bars must total 155 for a 300 s arrangement.
 */
const SONG = [
  { name: 'intro', kind: 'intro', bars: 16 },
  { name: 'drop A', kind: 'drop', bars: 32, lead: 0 },
  { name: 'break', kind: 'break', bars: 16 },
  { name: 'drop B', kind: 'drop', bars: 32, lead: 1 },
  { name: 'jazz', kind: 'jazz', bars: 16 },
  { name: 'vocal', kind: 'vocal', bars: 16 },
  { name: 'drop C', kind: 'drop', bars: 32, lead: 2 },
  { name: 'outro', kind: 'outro', bars: 11 },
]

const BARS = SONG.reduce((sum, section) => sum + section.bars, 0)

/** Expand the table into per-bar lookups. */
const barInfo = []
for (const section of SONG) {
  for (let i = 0; i < section.bars; i++) {
    barInfo.push({
      section,
      kind: section.kind,
      indexInSection: i,
      start: barInfo.length === 0 ? 0 : barInfo.length,
    })
  }
}

// ------------------------------------------------------------------- harmony

const PROGRESSION = [
  { root: 41, notes: [53, 56, 60, 63, 67] }, // Fm9   F Ab C Eb G
  { root: 37, notes: [49, 53, 56, 60, 63] }, // Dbmaj9
  { root: 44, notes: [56, 60, 63, 67, 70] }, // Abmaj9
  { root: 39, notes: [51, 55, 58, 61, 65] }, // Eb9
]

const P = { F4: 65, Ab4: 68, Bb4: 70, C5: 72, Eb5: 75, F5: 77, Eb4: 63 }

const FUNK = [
  [0.25, 0.1, 88], [0.5, 0.1, 58], [0.75, 0.1, 78],
  [1.5, 0.1, 84], [1.75, 0.1, 56],
  [2.25, 0.1, 88], [2.5, 0.1, 60], [2.75, 0.1, 78],
  [3.5, 0.1, 84], [3.75, 0.1, 58],
]

const FUNK_LIGHT = [
  [0.75, 0.1, 80], [1.75, 0.1, 70], [2.75, 0.1, 80], [3.75, 0.1, 70],
]

/** Break melody: one phrase per bar, long notes. */
const BREAK_LEAD = [
  [[0, 1.9, P.C5, 56], [2, 1.9, P.Ab4, 52]],
  [[0, 3.8, P.Eb5, 60]],
  [[0, 1.9, P.C5, 58], [2, 1.9, P.Bb4, 54]],
  [[0, 3.8, P.Ab4, 56]],
  [[0, 1.9, P.Eb5, 62], [2, 1.9, P.C5, 58]],
  [[0, 3.8, P.Bb4, 56]],
  [[0, 1.9, P.C5, 60], [2, 1.9, P.Eb5, 64]],
  [[0, 1.9, P.F5, 68], [2, 1.9, P.Eb5, 62]],
]

/** Four bars of clean jazz lines in F minor pentatonic, upper register. */
const JAZZ_PHRASE = [
  [[0, 0.45, P.C5, 84], [0.5, 0.45, P.Eb5, 80], [1, 0.45, P.F5, 88], [1.5, 0.45, P.Eb5, 78],
   [2.5, 0.45, P.C5, 82], [3, 0.9, P.Ab4, 80]],
  [[0, 0.45, P.Bb4, 84], [0.5, 0.45, P.C5, 80], [1, 0.45, P.Eb5, 88], [1.5, 0.45, P.C5, 78],
   [2.5, 0.45, P.Ab4, 82], [3, 0.9, P.F4, 78]],
  [[0, 0.45, P.F5, 90], [0.5, 0.45, P.Eb5, 82], [1, 0.45, P.C5, 86], [1.5, 0.45, P.Bb4, 78],
   [2.5, 0.45, P.C5, 82], [3, 0.45, P.Eb5, 86], [3.5, 0.45, P.F5, 90]],
  [[0, 1.8, P.Eb5, 88], [2, 0.45, P.C5, 80], [2.5, 0.45, P.Ab4, 78], [3, 1.2, P.F4, 84]],
]

/** Three 4-bar melodies for the three drops. */
const LEADS = [
  [
    [[0, 0.45, P.C5, 100], [0.5, 0.45, P.Eb5, 104], [1.5, 0.9, P.C5, 96],
     [2.5, 0.45, P.Ab4, 90], [3, 0.45, P.C5, 94], [3.5, 0.45, P.Eb5, 102]],
    [[0, 0.45, P.F5, 108], [0.5, 0.45, P.Eb5, 100], [1.5, 0.9, P.C5, 96],
     [2.5, 0.45, P.Ab4, 90], [3, 0.9, P.F4, 88]],
    [[0, 0.45, P.Bb4, 96], [0.5, 0.45, P.C5, 100], [1.5, 0.9, P.Eb5, 106],
     [2.5, 0.45, P.C5, 96], [3, 0.45, P.Bb4, 92], [3.5, 0.45, P.Ab4, 90]],
    [[0, 0.45, P.F4, 94], [0.5, 0.45, P.Eb4, 90], [1.5, 0.9, P.C5, 100],
     [2.5, 0.45, P.Ab4, 90], [3, 1.2, P.F4, 96]],
  ],
  [
    [[0, 0.45, P.Ab4, 96], [0.5, 0.45, P.Bb4, 98], [1.5, 0.9, P.C5, 104],
     [2.5, 0.45, P.Bb4, 94], [3, 0.45, P.Ab4, 90], [3.5, 0.45, P.F4, 92]],
    [[0, 0.9, P.Eb5, 104], [1.5, 0.45, P.C5, 96], [2.5, 0.9, P.Bb4, 94],
     [3.5, 0.45, P.C5, 98]],
    [[0, 0.45, P.C5, 100], [0.5, 0.45, P.Bb4, 94], [1.5, 0.9, P.Ab4, 98],
     [2.5, 0.45, P.F4, 92], [3, 0.9, P.Ab4, 96]],
    [[0, 0.45, P.Bb4, 96], [0.5, 0.45, P.C5, 100], [1.5, 1.8, P.Eb5, 108]],
  ],
  [
    [[0, 0.45, P.F5, 108], [0.5, 0.45, P.Eb5, 100], [1.5, 0.9, P.C5, 98],
     [2.5, 0.45, P.Bb4, 94], [3, 0.45, P.C5, 98], [3.5, 0.45, P.Eb5, 104]],
    [[0, 1.8, P.F5, 110], [2, 0.45, P.Eb5, 100], [3, 0.45, P.C5, 96]],
    [[0, 0.45, P.Ab4, 94], [0.5, 0.45, P.Bb4, 96], [1.5, 0.9, P.C5, 102],
     [2.5, 0.45, P.Bb4, 94], [3, 1.2, P.Ab4, 96]],
    [[0, 0.45, P.F4, 92], [0.5, 0.45, P.Ab4, 94], [1.5, 0.9, P.C5, 100],
     [2.5, 0.45, P.F5, 104], [3, 1.2, P.Eb5, 100]],
  ],
]

// ------------------------------------------------------------------- tracks

const drumEvents = []
const bassEvents = []
const chordEvents = []
const powerEvents = []
const leadEvents = []
const guitarEvents = []
const jazzEvents = []
const clavEvents = []

const setup = [
  [drumEvents, 'House Drums', 9, 0],
  [bassEvents, 'Sub Bass', 0, 38],
  [chordEvents, 'Stabs', 1, 4],
  [powerEvents, 'Power Chords', 3, 30],
  [leadEvents, 'Penta Lead', 4, 81],
  [guitarEvents, 'Muted Gtr', 5, 28],
  [clavEvents, 'Funk Clav', 2, 7],
  [jazzEvents, 'Jazz Gtr', 6, 26],
]
for (const [events, name, channel, program] of setup) {
  put(events, 0, RANK_SETUP, meta(0x03, str(name)))
  put(events, 0, RANK_SETUP, [0xc0 | channel, program])
}

// --------------------------------------------------------------- generation

for (let bar = 0; bar < BARS; bar++) {
  const { section, kind, indexInSection } = barInfo[bar]
  const isDrop = kind === 'drop'
  const isSoft = kind === 'intro' || kind === 'break' || kind === 'vocal' || kind === 'outro'
  const barStart = bar * BEATS_PER_BAR
  const chord = PROGRESSION[Math.floor(bar / 2) % PROGRESSION.length]
  const offbeats = [0.5, 1.5, 2.5, 3.5]
  const phrasePos = indexInSection % 4
  const isSectionEnd = indexInSection === section.bars - 1

  // --- drums: always kick and hats ---------------------------------------
  for (let beat = 0; beat < BEATS_PER_BAR; beat++) {
    note(drumEvents, T(barStart + beat), T(0.2), 36, isDrop ? 115 : 96, 9)
  }
  for (let i = 0; i < 16; i++) {
    const accent = i % 4 === 0
    const vel = isDrop ? (accent ? 88 : 52) : (accent ? 50 : 32)
    note(drumEvents, T(barStart + i * 0.25), T(0.1), 42, vel, 9)
  }
  if (isDrop) {
    for (const beat of [1, 3]) {
      note(drumEvents, T(barStart + beat), T(0.2), 39, 100, 9)
    }
    for (const beat of offbeats) {
      note(drumEvents, T(barStart + beat), T(0.18), 46, 78, 9)
    }
    for (const beat of [0.75, 1.25, 1.75, 2.75, 3.25, 3.75]) {
      note(drumEvents, T(barStart + beat), T(0.06), 38, 26, 9)
    }
  }

  // fills every four bars, plus a bigger one at the end of each section
  if (phrasePos === 3 && !isSectionEnd) {
    for (let i = 0; i < 4; i++) {
      note(drumEvents, T(barStart + 3 + i * 0.25), T(0.12), 38, 50 + i * 12, 9)
    }
  }
  if (isSectionEnd) {
    if (kind === 'outro') {
      const toms = [50, 47, 45, 41]
      toms.forEach((pitch, i) => {
        note(drumEvents, T(barStart + 2 + i * 0.5), T(0.2), pitch, 90, 9)
      })
      note(drumEvents, T(barStart + 3.5), T(0.3), 49, 95, 9)
    } else {
      for (let i = 0; i < 8; i++) {
        note(drumEvents, T(barStart + 2 + i * 0.25), T(0.1), 38, 55 + i * 8, 9)
      }
      note(drumEvents, T(barStart + 3), T(0.2), 36, 110, 9)
    }
  }

  // --- bass: continuous --------------------------------------------------
  const bassVel = isDrop ? 105 : 78
  offbeats.forEach((beat, i) => {
    const turnaround = isSectionEnd && beat === 3.5
    const pitch = turnaround ? chord.root + 7 : i === 2 ? chord.root + 12 : chord.root
    note(bassEvents, T(barStart + beat), T(turnaround ? 0.18 : 0.22), pitch, bassVel, 0)
  })

  // --- muted guitar: continuous, but it sits out the jazz section --------
  if (kind !== 'jazz') {
  note(guitarEvents, T(barStart), T(0.1), 26, isDrop ? 56 : 44, 5)
  const chugs = isDrop
    ? [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75]
    : [0.75, 1.75, 2.75, 3.75]
  chugs.forEach((beat, i) => {
    const vel = isDrop ? (i % 2 === 0 ? 92 : 64) : 66
    note(guitarEvents, T(barStart + beat), T(0.1), chord.root + 12, vel, 5)
  })
  if (isDrop) {
    const voicing = [chord.root + 12, chord.root + 19, chord.root + 24]
    voicing.forEach((pitch, i) => {
      note(guitarEvents, T(barStart) + i * 14, T(i === 0 ? 0.2 : 0.35), pitch, 96 - i * 6, 5)
    })
  }
  }

  // --- clav: continuous, except in the jazz section ----------------------
  if (kind !== 'jazz') {
    const clavBeat = isDrop ? FUNK : FUNK_LIGHT
    const clavShift = isDrop ? 0 : -16
    const chank = [chord.notes[1], chord.notes[3], chord.notes[4]]
    for (const [beat, length, velocity] of clavBeat) {
      for (const pitch of chank) {
        note(clavEvents, T(barStart + beat), T(length), pitch, Math.max(22, velocity + clavShift), 2)
      }
    }
  }

  // --- chords ------------------------------------------------------------
  if (isDrop) {
    for (const beat of offbeats) {
      for (const pitch of chord.notes) {
        note(chordEvents, T(barStart + beat), T(0.16), pitch, 72, 1)
      }
    }
    const power = [chord.root + 12, chord.root + 19, chord.root + 24]
    for (const beat of [0.5, 2.5]) {
      for (const pitch of power) {
        note(powerEvents, T(barStart + beat), T(0.7), pitch, 88, 3)
      }
    }
  } else if (kind !== 'jazz') {
    for (const pitch of chord.notes) {
      note(chordEvents, T(barStart), T(2.4), pitch, isSoft ? 50 : 58, 1)
    }
  }

  // --- jazz guitar: comping plus a four-bar line -------------------------
  if (kind === 'jazz') {
    // comping goes on its own MIDI channel (7) so the GP exporter can put it in
    // voice 2; the line stays on channel 6 in voice 1
    const comp = [chord.notes[1], chord.notes[3], chord.notes[4]]
    for (const beat of [1, 3.5]) {
      for (const pitch of comp) {
        note(jazzEvents, T(barStart + beat), T(0.4), pitch, 62, 7)
      }
    }
    const line = JAZZ_PHRASE[indexInSection % JAZZ_PHRASE.length]
    for (const [beat, length, pitch, velocity] of line) {
      note(jazzEvents, T(barStart + beat), T(length), pitch, velocity, 6)
    }
  }

  // --- break melody ------------------------------------------------------
  if (kind === 'break') {
    const phrase = BREAK_LEAD[indexInSection % BREAK_LEAD.length]
    for (const [beat, length, pitch, velocity] of phrase) {
      note(leadEvents, T(barStart + beat), T(length), pitch, velocity + 14, 4)
    }
  }

  // --- drop melodies: alternate two 4-bar phrases ------------------------
  if (isDrop && phrasePos < 4) {
    const set = LEADS[section.lead]
    const phraseIndex = (Math.floor(indexInSection / 4) + phrasePos) % 2
    const phrase = set[phraseIndex * 2 + phrasePos % 2]
    if (phrase !== undefined) {
      for (const [beat, length, pitch, velocity] of phrase) {
        note(leadEvents, T(barStart + beat), T(length), pitch, velocity, 4)
      }
    }
  }
}

// ---------------------------------------------------------------- containers

const conductor = []
put(conductor, 0, RANK_SETUP, meta(0x03, str('House 124')))
put(conductor, 0, RANK_SETUP, meta(0x51, u32(Math.round(60_000_000 / BPM)).slice(1)))
put(conductor, 0, RANK_SETUP, meta(0x58, [4, 2, 24, 8]))

const tracks = [conductor, drumEvents, bassEvents, chordEvents, powerEvents, leadEvents, guitarEvents, clavEvents, jazzEvents]
const header = [...str('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ)]
const bytes = [...header, ...tracks.flatMap(track)]

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, Buffer.from(bytes))

const tempoMeta = meta(0x51, u32(Math.round(60_000_000 / BPM)).slice(1))
const timeSigMeta = meta(0x58, [4, 2, 24, 8])

function writeSingle(file, events, label) {
  const copy = [...events]
  put(copy, 0, RANK_SETUP, tempoMeta)
  put(copy, 0, RANK_SETUP, timeSigMeta)
  const chunk = track(copy)
  const single = [...str('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(PPQ), ...chunk]
  writeFileSync(join(outDir, file), Buffer.from(single))
  const count = events.filter(e => (e.bytes[0] & 0xf0) === 0x90).length
  console.log(`  ${file}: ${count} notes (${label})`)
}

writeSingle('house-drums.mid', drumEvents, 'channel 10')
writeSingle('house-bass.mid', bassEvents, 'channel 1')
writeSingle('house-stabs.mid', chordEvents, 'channel 2')
writeSingle('house-power.mid', powerEvents, 'channel 4')
writeSingle('house-lead.mid', leadEvents, 'channel 5')
writeSingle('house-gtr.mid', guitarEvents, 'channel 6')
writeSingle('house-clav.mid', clavEvents, 'channel 3')
writeSingle('house-jazz.mid', jazzEvents, 'channel 7')

// Section timeline for the REAPER project builder.
let cursor = 0
const timeline = SONG.map((section) => {
  const entry = { name: section.name, kind: section.kind, startBar: cursor, bars: section.bars }
  cursor += section.bars
  return entry
})
writeFileSync(join(outDir, 'timeline.json'), JSON.stringify({
  bpm: BPM,
  bars: BARS,
  barSeconds: BAR,
  seconds: BARS * BAR,
  sections: timeline,
}, null, 2))

console.log(`wrote ${outFile}`)
console.log(`tracks=${tracks.length} bytes=${bytes.length} bars=${BARS} seconds=${(BARS * BAR).toFixed(1)}`)



