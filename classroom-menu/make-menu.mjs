/**
 * Menu theme: an empty classroom after school.
 *
 * 96 BPM, A natural minor, 40 bars = exactly 100 s. The four-bar loop is
 * Am - F - C - G; section B swaps F for Bb (the bII "Neapolitan" chord) which
 * is the mild wrongness the brief asks for. Nothing ever jumps: the loudest
 * thing in the piece is a shaker at velocity 40.
 *
 * Form: intro 8 | A 16 | B 8 | return 8
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PPQ = 480
const BPM = 96
const BEAT = 60 / BPM
const BAR = BEAT * 4

const HERE = dirname(fileURLToPath(import.meta.url))

const T = (beats) => Math.round(beats * PPQ)

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
const u32 = (n) => [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const u16 = (n) => [(n >> 8) & 0xff, n & 0xff]
const str = (s) => [...Buffer.from(s, 'latin1')]
const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data]

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
function note(events, tick, durationTicks, pitch, velocity, channel) {
  put(events, tick, 1, [0x90 | channel, pitch, velocity])
  put(events, tick + durationTicks, 0, [0x80 | channel, pitch, 0])
}

// ------------------------------------------------------------------ harmony

const CHORD = {
  Am: { root: 33, notes: [57, 60, 64] },
  F: { root: 29, notes: [53, 57, 60] },
  C: { root: 36, notes: [55, 60, 64] },
  G: { root: 31, notes: [55, 59, 62] },
  Bb: { root: 34, notes: [58, 62, 65] },
  E: { root: 28, notes: [52, 56, 59] },
}

const LOOP_A = ['Am', 'F', 'C', 'G']
const LOOP_B = ['Am', 'Bb', 'F', 'E']

const SONG = [
  { name: 'intro', bars: 8 },
  { name: 'A', bars: 16 },
  { name: 'B', bars: 8 },
  { name: 'return', bars: 8 },
]

/** Music-box motif, [beat, pitch] pairs; sparse on purpose. */
const PHRASE_INTRO = [
  [[0, 76], [1.5, 81], [3, 84]],
  [[0, 83], [2, 81], [3.5, 76]],
]

const PHRASE_A = [
  [[0, 76], [1.5, 81], [3, 84]],
  [[0, 81], [1, 77], [2, 72], [3, 77]],
  [[0, 79], [1.5, 76], [2.5, 72], [3.5, 76]],
  [[0, 74], [1, 79], [2, 83], [3, 74]],
]

const PHRASE_B = [
  [[0, 84], [1, 88], [2, 84], [3, 81]],
  [[0, 86], [1, 82], [2, 86], [3, 89]],
  [[0, 84], [1, 81], [2, 77], [3, 84]],
  [[0, 80], [1, 83], [2, 88], [3, 80]],
]

// -------------------------------------------------------------------- tracks

const musicBox = []
const rhodes = []
const pad = []
const bass = []
const shaker = []

const setup = [
  [musicBox, 'Music Box', 0, 10],
  [rhodes, 'Rhodes', 1, 4],
  [pad, 'Pad', 2, 89],
  [bass, 'Bass', 3, 33],
  [shaker, 'Shaker', 4, 0],
]
for (const [events, name, channel, program] of setup) {
  put(events, 0, 2, meta(0x03, str(name)))
  put(events, 0, 2, [0xc0 | channel, program])
}

let cursor = 0
const sections = SONG.map((section) => {
  const entry = { name: section.name, ...section, startBar: cursor }
  cursor += section.bars
  return entry
})
const BARS = cursor

function sectionAt(bar) {
  for (const section of sections) {
    if (bar < section.startBar + section.bars) return section
  }
  return sections[sections.length - 1]
}

for (let bar = 0; bar < BARS; bar++) {
  const section = sectionAt(bar)
  const inSection = bar - section.startBar
  const barStart = bar * 4
  const loop = section.name === 'B' ? LOOP_B : LOOP_A
  const chordName = loop[bar % 4]
  const chord = CHORD[chordName]

  // --- pad: one sustained chord per bar, very low velocity ----------------
  for (const pitch of chord.notes) {
    note(pad, T(barStart), T(3.9), pitch + 12, 34, 2)
  }
  note(pad, T(barStart), T(3.9), chord.root + 12, 30, 2)

  // --- rhodes: enters after the intro, two soft chords per bar ------------
  if (section.name !== 'intro') {
    // ease the Rhodes in over the first four bars of A
    const fadeIn = section.name === 'A' && inSection < 6 ? 0.52 + inSection * 0.08 : 1
    for (const beat of [0, 2.5]) {
      for (const pitch of chord.notes) {
        const base = beat === 0 ? 52 : 44
        note(rhodes, T(barStart + beat), T(1.2), pitch, Math.round(base * fadeIn), 1)
      }
    }
  }

  // --- bass: one long note per bar, leaves space --------------------------
  // it creeps in two bars before A so the low end is already there when the
  // chords land — no jump at the section change
  if (section.name !== 'intro' || inSection >= 6) {
    note(bass, T(barStart), T(3.8), chord.root, section.name === 'intro' ? 42 : 58, 3)
  }

  // --- shaker: the only percussion, and only in A and B -------------------
  if (section.name === 'A' || section.name === 'B') {
    // the shaker fades in across the first six bars of A as well
    const shakerGain = section.name === 'A' && inSection < 6 ? 0.4 + inSection * 0.1 : 1
    for (let i = 0; i < 8; i++) {
      const beat = i * 0.5
      const velocity = Math.round((i % 2 === 0 ? 38 : 28) * shakerGain)
      note(shaker, T(barStart + beat), T(0.2), 70, velocity, 4)
    }
  }

  // --- music box ----------------------------------------------------------
  if (section.name === 'intro') {
    const phrase = PHRASE_INTRO[inSection % PHRASE_INTRO.length]
    // only two or three notes per bar in the intro
    for (const [beat, pitch] of phrase.slice(0, inSection < 4 ? 2 : 3)) {
      note(musicBox, T(barStart + beat), T(2), pitch, 62, 0)
    }
  } else if (section.name === 'A') {
    const phrase = PHRASE_A[inSection % PHRASE_A.length]
    for (const [beat, pitch] of phrase) {
      note(musicBox, T(barStart + beat), T(1.6), pitch, 64, 0)
    }
  } else if (section.name === 'B') {
    const phrase = PHRASE_B[inSection % PHRASE_B.length]
    for (const [beat, pitch] of phrase) {
      note(musicBox, T(barStart + beat), T(1.6), pitch, 68, 0)
    }
  } else {
    // return: thin back to the intro motif so the loop is seamless
    const phrase = PHRASE_INTRO[inSection % PHRASE_INTRO.length]
    for (const [beat, pitch] of phrase.slice(0, inSection < 4 ? 3 : 2)) {
      note(musicBox, T(barStart + beat), T(2), pitch, 58, 0)
    }
  }
}

// ----------------------------------------------------------------- containers

const conductor = []
put(conductor, 0, 2, meta(0x03, str('Classroom Menu 96')))
put(conductor, 0, 2, meta(0x51, u32(Math.round(60_000_000 / BPM)).slice(1)))
put(conductor, 0, 2, meta(0x58, [4, 2, 24, 8]))

const tracks = [conductor, musicBox, rhodes, pad, bass, shaker]
const header = [...str('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ)]
writeFileSync(join(HERE, 'menu-96-amin.mid'), Buffer.from([...header, ...tracks.flatMap(track)]))

const tempoMeta = meta(0x51, u32(Math.round(60_000_000 / BPM)).slice(1))
const tsMeta = meta(0x58, [4, 2, 24, 8])
function writeSingle(file, events, label) {
  const copy = [...events]
  put(copy, 0, 2, tempoMeta)
  put(copy, 0, 2, tsMeta)
  const chunk = track(copy)
  writeFileSync(join(HERE, file), Buffer.from([...str('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(PPQ), ...chunk]))
  const count = events.filter((e) => (e.bytes[0] & 0xf0) === 0x90).length
  console.log(`  ${file}: ${count} notes (${label})`)
}

writeSingle('menu-musicbox.mid', musicBox, 'channel 1')
writeSingle('menu-rhodes.mid', rhodes, 'channel 2')
writeSingle('menu-pad.mid', pad, 'channel 3')
writeSingle('menu-bass.mid', bass, 'channel 4')
writeSingle('menu-shaker.mid', shaker, 'channel 5')

writeFileSync(
  join(HERE, 'timeline.json'),
  JSON.stringify({ bpm: BPM, bars: BARS, barSeconds: BAR, seconds: BARS * BAR, sections }, null, 2),
)

console.log(`bars=${BARS} seconds=${(BARS * BAR).toFixed(1)}`)


