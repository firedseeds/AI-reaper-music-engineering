/**
 * Thrash metal sketch: 190 BPM, E minor, 128 bars (2:42).
 *
 * Rhythm guitars are double-tracked (two identical MIDI files, panned hard
 * left and right), which is how the genre gets its width. Bass doubles the
 * guitar roots an octave down; drums are a 16th-note double-kick pattern with
 * the snare on 2 and 4.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PPQ = 480
const BPM = 190
const BEAT = 60 / BPM
const BAR = BEAT * 4
const SIXTEENTH = BAR / 16

const outDir = dirname(fileURLToPath(import.meta.url))

const T = sixteenth => Math.round(sixteenth * (PPQ / 4))

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
  put(events, tick, 1, [0x90 | channel, pitch, velocity])
  put(events, tick + durationTicks, 0, [0x80 | channel, pitch, 0])
}

// ------------------------------------------------------------------- riffs

const NOTE = { E: 40, F: 41, Fs: 42, G: 43, A: 45, Bb: 46, B: 47, C: 48, D: 50 }

/** One bar = 16 sixteenths. `null` is a rest. */
const RIFF_A = [
  'E', 'E', 'E', 'E', 'E', 'E', 'E', 'E',
  'G', 'G', 'E', 'E', 'A', 'Bb', 'E', 'E',
]
const RIFF_B = [
  'E', 'E', 'G', 'G', 'A', 'A', 'Bb', 'Bb',
  'E', 'E', 'E', 'E', 'G', 'A', 'Bb', 'B',
]
const RIFF_C = [
  'E', null, 'E', null, 'E', null, 'E', null,
  'E', null, 'E', null, 'E', null, 'E', null,
]

const SONG = [
  { name: 'intro', kind: 'intro', bars: 16, riff: RIFF_A },
  { name: 'verse', kind: 'verse', bars: 16, riff: RIFF_A },
  { name: 'chorus', kind: 'chorus', bars: 16, riff: RIFF_B },
  { name: 'verse 2', kind: 'verse', bars: 16, riff: RIFF_A },
  { name: 'chorus 2', kind: 'chorus', bars: 16, riff: RIFF_B },
  { name: 'bridge', kind: 'bridge', bars: 8, riff: RIFF_C },
  { name: 'solo', kind: 'solo', bars: 16, riff: RIFF_A },
  { name: 'sweep', kind: 'sweep', bars: 16, riff: RIFF_C },
  { name: 'vocal', kind: 'vocal', bars: 16, riff: RIFF_C },
  { name: 'chorus 3', kind: 'chorus', bars: 16, riff: RIFF_B },
  { name: 'outro', kind: 'outro', bars: 8, riff: RIFF_C },
]

const BARS = SONG.reduce((sum, s) => sum + s.bars, 0)

// ------------------------------------------------------------------- tracks

const gtrL = []
const gtrR = []
const bassEvents = []
const drumEvents = []
const leadEvents = []

const setup = [
  [gtrL, 'Rhythm L', 0, 30],
  [gtrR, 'Rhythm R', 1, 30],
  [bassEvents, 'Bass', 2, 33],
  [leadEvents, 'Lead', 3, 29],
  [drumEvents, 'Drums', 9, 0],
]
for (const [events, name, channel, program] of setup) {
  put(events, 0, 2, meta(0x03, str(name)))
  put(events, 0, 2, [0xc0 | channel, program])
}

/** Power chord: root, fifth, octave. */
function powerChord(events, tick, length, root, velocity, channel) {
  for (const pitch of [root, root + 7, root + 12]) {
    note(events, tick, length, pitch, velocity, channel)
  }
}

const SOLO = [
  ['E5', 'G5', 'A5', 'B5', 'D6', 'B5', 'A5', 'G5', 'E5', 'G5', 'A5', 'B5', 'D6', 'E6', 'D6', 'B5'],
  ['E5', 'D5', 'B4', 'A4', 'G4', 'A4', 'B4', 'D5', 'E5', 'G5', 'A5', 'G5', 'E5', 'D5', 'B4', 'A4'],
]
/** Sweep picking shapes: eight tones per arpeggio, played up then down. */
const SWEEP = {
  Em: [52, 55, 59, 64, 67, 71, 76, 79],
  C: [48, 52, 55, 60, 64, 67, 72, 76],
  G: [43, 47, 50, 55, 59, 62, 67, 71],
  D: [50, 54, 57, 62, 66, 69, 74, 78],
}
const SWEEP_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 0]

const SOLO_PITCH = { E6: 88, D6: 86, B5: 83, A5: 81, G5: 79, E5: 76, D5: 74, B4: 71, A4: 69, G4: 67 }

/**
 * Per-section drum phrasing. Each kind gets its own vocabulary instead of one
 * shared pattern: half-time in the intro, double-kick in the chorus, a skank
 * beat under the sweep, tom cascades to finish sections.
 * @returns {[number, number, number][]} [sixteenth index, pitch, velocity]
 */
function drumBar(kind, inSection, sectionBars) {
  const hits = []
  const add = (i, pitch, vel) => hits.push([i, pitch, vel])
  const fillBar = inSection % 4 === 3
  const lastBar = inSection === sectionBars - 1

  if (kind === 'intro') {
    if (inSection < 8) {
      for (let i = 0; i < 16; i += 2) add(i, 42, inSection < 4 ? 28 : 46)
      return hits
    }
    for (const i of [0, 4, 8, 12]) add(i, 36, 110)
    for (const i of [4, 12]) add(i, 38, 104)
    for (let i = 0; i < 16; i += 2) add(i, 42, 54)
    if (lastBar) for (let i = 8; i < 16; i++) add(i, 38, 60 + i * 3)
    return hits
  }

  if (kind === 'verse') {
    for (const i of [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15]) add(i, 36, 118)
    for (const i of [4, 12]) add(i, 38, 112)
    for (let i = 0; i < 16; i += 2) add(i, 51, 86)
    if (fillBar) for (let i = 12; i < 16; i++) add(i, i % 2 ? 47 : 45, 100)
    return hits
  }

  if (kind === 'chorus') {
    for (let i = 0; i < 16; i++) add(i, 36, i % 4 === 0 ? 120 : 104)
    for (const i of [4, 12]) add(i, 38, 116)
    for (let i = 0; i < 16; i += 2) add(i, 51, 80)
    add(0, 49, 118)
    if (lastBar) for (let i = 12; i < 16; i++) add(i, 50 - (i % 3) * 2, 106)
    return hits
  }

  if (kind === 'bridge') {
    for (const i of [0, 6, 8, 14]) add(i, 36, 120)
    for (const i of [4, 12]) add(i, 38, 118)
    add(0, 49, 120)
    if (lastBar) for (let i = 8; i < 16; i++) add(i, 41 + (i % 4) * 2, 102)
    return hits
  }

  if (kind === 'solo') {
    for (const i of [0, 4, 8, 12]) add(i, 36, 112)
    for (const i of [4, 12]) add(i, 38, 110)
    for (let i = 0; i < 16; i += 2) add(i, 51, 88)
    if (fillBar) for (let i of [12, 13, 14, 15]) add(i, 38, 90 + i * 2)
    return hits
  }

  if (kind === 'sweep') {
    // skank beat: kick and snare trading sixteenths, ride on top
    for (let i = 0; i < 16; i++) {
      if (i % 2 === 0) add(i, 36, 116)
      else add(i, 38, 96)
    }
    add(0, 49, 120)
    for (let i = 0; i < 16; i += 2) add(i, 51, 78)
    if (fillBar) for (let i = 12; i < 16; i++) add(i, 47 - (i % 3) * 2, 100)
    return hits
  }

  if (kind === 'vocal') {
    for (const i of [0, 4, 8, 12]) add(i, 36, 118)
    for (const i of [4, 12]) add(i, 38, 116)
    add(0, 49, 118)
    if (lastBar) for (let i = 12; i < 16; i++) add(i, 38, 100 + i * 2)
    return hits
  }

  // outro
  for (const i of [0, 4, 8, 12]) add(i, 36, 116)
  for (const i of [4, 12]) add(i, 38, 110)
  add(0, 49, 120)
  if (lastBar) {
    const toms = [50, 48, 47, 45, 43, 41]
    toms.forEach((pitch, k) => add(8 + k, pitch, 108))
    add(15, 49, 120)
  }
  return hits
}

for (let bar = 0; bar < BARS; bar++) {
  let cursor = 0
  let section = SONG[0]
  for (const s of SONG) {
    if (bar < cursor + s.bars) { section = s; break }
    cursor += s.bars
  }
  const inSection = bar - cursor
  const riff = section.riff
  const barStart = bar * 16 // sixteenth index

  const isIntro = section.kind === 'intro'
  const isOutro = section.kind === 'outro'
  const drumsIn = !isIntro || inSection >= 8

  // --- rhythm guitars (both sides, identical) ---------------------------
  for (let i = 0; i < 16; i++) {
    const name = riff[i]
    if (name === null) continue
    const root = NOTE[name]
    const accent = i % 4 === 0
    const velocity = accent ? 112 : 92
    // staccato: a palm-muted chug is mostly attack
    const length = T(0.9)
    powerChord(gtrL, T(barStart + i), length, root, velocity, 0)
    powerChord(gtrR, T(barStart + i), length, root, velocity, 1)
  }

  // --- bass: eighth notes on the root, an octave down -------------------
  // In the vocal section the bass locks to the shout: sixteenth-note chugs on
  // the bars where a phrase lands, so voice and low end hit together.
  if (section.kind === 'vocal' && inSection % 4 === 0) {
    for (let i = 0; i < 16; i++) {
      note(bassEvents, T(barStart + i), T(0.9), NOTE.E - 12, i % 4 === 0 ? 118 : 98, 2)
    }
  } else {
    for (let i = 0; i < 16; i += 2) {
      const name = riff[i]
      if (name === null) continue
      note(bassEvents, T(barStart + i), T(1.8), NOTE[name] - 12, 104, 2)
    }
  }

  // --- drums -------------------------------------------------------------
  for (const [i, pitch, vel] of drumBar(section.kind, inSection, section.bars)) {
    note(drumEvents, T(barStart + i), T(1), pitch, vel, 9)
  }

  // --- solo --------------------------------------------------------------
  if (section.kind === 'solo') {
    const phrase = SOLO[Math.floor(inSection / 2) % SOLO.length]
    for (let i = 0; i < 16; i++) {
      const pitch = SOLO_PITCH[phrase[i]]
      note(leadEvents, T(barStart + i), T(0.9), pitch, i % 4 === 0 ? 108 : 96, 3)
    }
  }

  // --- sweep picking -----------------------------------------------------
  if (section.kind === 'sweep') {
    const cycle = ['Em', 'C', 'G', 'D']
    const tones = SWEEP[cycle[inSection % cycle.length]]
    const next = SWEEP[cycle[(inSection + 1) % cycle.length]]
    const nextRoot = next[0]
    for (let i = 0; i < 16; i++) {
      let pitch = tones[SWEEP_ORDER[i]]
      // last two sixteenths: tritone of the next chord, then its octave as a
      // pickup — the classic metal turn into the next arpeggio
      if (i === 14) pitch = nextRoot + 18
      if (i === 15) pitch = nextRoot + 12
      note(leadEvents, T(barStart + i), T(0.85), pitch, i % 4 === 0 ? 110 : 92, 3)
    }
  }

  // --- final hit ---------------------------------------------------------
  if (isOutro && inSection === section.bars - 1) {
    for (const events of [gtrL, gtrR]) {
      powerChord(events, T(barStart), T(8), NOTE.E, 120, events === gtrL ? 0 : 1)
    }
    note(bassEvents, T(barStart), T(8), NOTE.E - 12, 118, 2)
  }
}

// ---------------------------------------------------------------- containers

const conductor = []
put(conductor, 0, 2, meta(0x03, str('Thrash 190')))
put(conductor, 0, 2, meta(0x51, u32(Math.round(60_000_000 / BPM)).slice(1)))
put(conductor, 0, 2, meta(0x58, [4, 2, 24, 8]))

const tracks = [conductor, gtrL, gtrR, bassEvents, leadEvents, drumEvents]
const header = [...str('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ)]
const bytes = [...header, ...tracks.flatMap(track)]

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'thrash-190-em.mid'), Buffer.from(bytes))

const tempoMeta = meta(0x51, u32(Math.round(60_000_000 / BPM)).slice(1))
const tsMeta = meta(0x58, [4, 2, 24, 8])
function writeSingle(file, events, label) {
  const copy = [...events]
  put(copy, 0, 2, tempoMeta)
  put(copy, 0, 2, tsMeta)
  const chunk = track(copy)
  const single = [...str('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(PPQ), ...chunk]
  writeFileSync(join(outDir, file), Buffer.from(single))
  const count = events.filter(e => (e.bytes[0] & 0xf0) === 0x90).length
  console.log(`  ${file}: ${count} notes (${label})`)
}

writeSingle('thrash-gtr-l.mid', gtrL, 'channel 1')
writeSingle('thrash-gtr-r.mid', gtrR, 'channel 2')
writeSingle('thrash-bass.mid', bassEvents, 'channel 3')
writeSingle('thrash-lead.mid', leadEvents, 'channel 4')
writeSingle('thrash-drums.mid', drumEvents, 'channel 10')

let cursor = 0
const timeline = SONG.map((s) => {
  const entry = { name: s.name, kind: s.kind, startBar: cursor, bars: s.bars }
  cursor += s.bars
  return entry
})
writeFileSync(join(outDir, 'timeline.json'), JSON.stringify({
  bpm: BPM, bars: BARS, barSeconds: BAR, seconds: BARS * BAR, sections: timeline,
}, null, 2))

console.log(`bars=${BARS} seconds=${(BARS * BAR).toFixed(1)}`)




