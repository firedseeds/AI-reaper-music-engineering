/**
 * Battle theme: the corridor fight, not the boss fight.
 *
 * Direction B — lightweight drum & bass. 172 BPM, A minor, two-step drums,
 * a walking sub bass and short chord slices. No distortion anywhere: the speed
 * comes from the tempo and the drum grid, not from gain.
 *
 * Bar counts are doubled relative to the brief (intro 8 / A 32 / B 16 / A 16)
 * because 36 bars at 172 BPM would be 50 s, under the 90 s floor. The
 * proportions 1:4:2:2 are unchanged.
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PPQ = 480
const BPM = 172
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

const CHORDS = {
  Am7: { root: 33, notes: [57, 60, 64, 67], bass: 33 },
  Fmaj7: { root: 29, notes: [53, 57, 60, 64], bass: 29 },
  G6: { root: 31, notes: [55, 59, 62, 64], bass: 31 },
  Em7: { root: 28, notes: [52, 55, 59, 62], bass: 28 },
}

const LOOP_A = ['Am7', 'Am7', 'Fmaj7', 'G6']
const LOOP_B = ['Fmaj7', 'G6', 'Am7', 'Em7']

const SONG = [
  { name: 'intro', bars: 8 },
  { name: 'A', bars: 32 },
  { name: 'B', bars: 16 },
  { name: 'A2', bars: 16 },
]

// ------------------------------------------------------------------- tracks

const drums = []
const bass = []
const chords = []
const arp = []

const setup = [
  [drums, 'Drums', 9, 0],
  [bass, 'Sub Bass', 0, 38],
  [chords, 'Chord Slices', 1, 4],
  [arp, 'Arp', 2, 81],
]
for (const [events, name, channel, program] of setup) {
  put(events, 0, 2, meta(0x03, str(name)))
  if (channel !== 9) put(events, 0, 2, [0xc0 | channel, program])
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

const DRUM = { kick: 36, snare: 38, hat: 42, openHat: 46, ride: 51, rim: 37 }

for (let bar = 0; bar < BARS; bar++) {
  const section = sectionAt(bar)
  const inSection = bar - section.startBar
  const barStart = bar * 4
  const loop = section.name === 'B' ? LOOP_B : LOOP_A
  const chord = CHORDS[loop[bar % 4]]
  const isIntro = section.name === 'intro'
  const isB = section.name === 'B'

  // --- drums: two-step --------------------------------------------------
  // kick on 1 and 3.5, snare on 2 and 4, hats on eighths
  const kicks = isB ? [0, 0.75, 10 * 0.25, 2.75] : [0, 2.5]
  for (const beat of kicks) {
    note(drums, T(barStart + beat), T(1), DRUM.kick, 118, 9)
  }
  for (const beat of [1, 3]) {
    note(drums, T(barStart + beat), T(1), DRUM.snare, 110, 9)
  }
  const hatStep = isB ? 0.25 : 0.5
  for (let beat = 0; beat < 4; beat += hatStep) {
    const accented = Math.abs(beat % 1) < 1e-6
    note(drums, T(barStart + beat), T(0.2), DRUM.hat, accented ? 54 : 40, 9)
  }
  // ghost snares give it the shuffle without adding weight
  if (!isIntro && inSection % 4 === 3) {
    note(drums, T(barStart + 2.75), T(0.2), DRUM.snare, 44, 9)
  }
  // crash on section starts
  if (inSection === 0) note(drums, T(barStart), T(1), 49, 96, 9)

  // --- sub bass: walking, one note per eighth with rests ----------------
  const bassBeats = [
    [0, chord.bass, 2],
    [0.75, chord.bass, 1],
    [1.5, chord.bass + 7, 1],
    [2.5, chord.bass, 2],
    [3.25, chord.bass + 12, 1],
  ]
  for (const [beat, pitch, length] of bassBeats) {
    note(bass, T(barStart + beat), T(length * 0.5), pitch, isIntro ? 96 : 108, 0)
  }

  // --- chord slices: short stabs on the offbeats ------------------------
  if (!isIntro) {
    const stabs = isB ? [0.5, 1.5, 2.5, 3.5] : [0.5, 2.5]
    for (const beat of stabs) {
      for (const pitch of chord.notes) {
        note(chords, T(barStart + beat), T(0.18), pitch, isB ? 78 : 70, 1)
      }
    }
  }

  // --- arp: only in B, on eighths ---------------------------------------
  if (isB) {
    const tones = chord.notes.map((p) => p + 12)
    for (let i = 0; i < 8; i++) {
      const pitch = tones[i % tones.length]
      note(arp, T(barStart + i * 0.5), T(0.45), pitch, i % 2 === 0 ? 74 : 62, 2)
    }
  }
}

// ----------------------------------------------------------------- containers

const conductor = []
put(conductor, 0, 2, meta(0x03, str('Battle 172')))
put(conductor, 0, 2, meta(0x51, u32(Math.round(60_000_000 / BPM)).slice(1)))
put(conductor, 0, 2, meta(0x58, [4, 2, 24, 8]))

const tracks = [conductor, drums, bass, chords, arp]
const header = [...str('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ)]
writeFileSync(join(HERE, 'battle-172-amin.mid'), Buffer.from([...header, ...tracks.flatMap(track)]))

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

writeSingle('battle-drums.mid', drums, 'channel 10')
writeSingle('battle-bass.mid', bass, 'channel 1')
writeSingle('battle-chords.mid', chords, 'channel 2')
writeSingle('battle-arp.mid', arp, 'channel 3')

writeFileSync(
  join(HERE, 'timeline.json'),
  JSON.stringify({ bpm: BPM, bars: BARS, barSeconds: BAR, seconds: BARS * BAR, sections }, null, 2),
)

console.log(`bars=${BARS} seconds=${(BARS * BAR).toFixed(1)}`)
