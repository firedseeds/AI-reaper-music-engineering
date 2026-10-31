/**
 * Minimal Standard MIDI File reader used to validate the generated sketch.
 * Reports per-track note counts, channels and the final tick.
 */

import { readFileSync } from 'node:fs'

const buf = readFileSync(process.argv[2] ?? 'house-124-fmin.mid')

function u32(o) { return buf.readUInt32BE(o) }
function u16(o) { return buf.readUInt16BE(o) }

if (buf.toString('latin1', 0, 4) !== 'MThd') throw new Error('not a midi file')
const headerLen = u32(4)
const format = u16(8)
const ntrks = u16(10)
const division = u16(12)
console.log(`format=${format} tracks=${ntrks} ppq=${division} headerLen=${headerLen}`)

let offset = 8 + headerLen
const reports = []

for (let t = 0; t < ntrks; t++) {
  if (buf.toString('latin1', offset, offset + 4) !== 'MTrk') throw new Error(`track ${t}: bad chunk at ${offset}`)
  const len = u32(offset + 4)
  let p = offset + 8
  const end = p + len
  let tick = 0
  let status = 0
  const notes = []
  const names = []
  let tempo = null

  const readVlq = () => {
    let v = 0
    for (;;) {
      const b = buf[p++]
      v = (v << 7) | (b & 0x7f)
      if ((b & 0x80) === 0) return v
    }
  }

  while (p < end) {
    tick += readVlq()
    let b = buf[p]
    if (b === 0xff) {
      p++
      const type = buf[p++]
      const l = readVlq()
      const data = buf.subarray(p, p + l)
      p += l
      if (type === 0x03) names.push(data.toString('latin1'))
      if (type === 0x51) tempo = (data[0] << 16) | (data[1] << 8) | data[2]
      if (type === 0x2f) break
      continue
    }
    if (b === 0xf0 || b === 0xf7) {
      p++
      const l = readVlq()
      p += l
      continue
    }
    if (b & 0x80) {
      status = b
      p++
    }
    const type = status & 0xf0
    const channel = status & 0x0f
    if (type === 0x90 || type === 0x80) {
      const pitch = buf[p++]
      const velocity = buf[p++]
      if (type === 0x90 && velocity > 0) notes.push({ tick, pitch, velocity, channel })
    } else if (type === 0xc0 || type === 0xd0) {
      p += 1
    } else {
      p += 2
    }
  }

  reports.push({ track: t, name: names[0] ?? '', notes: notes.length, channels: [...new Set(notes.map(n => n.channel))], lastTick: tick, tempo })
  offset = end
}

for (const r of reports) {
  console.log(
    `track ${r.track}: name="${r.name}" notes=${r.notes} channels=${r.channels.map(c => c + 1).join(',')} lastTick=${r.lastTick}` +
    (r.tempo ? ` tempo=${r.tempo} (${(60_000_000 / r.tempo).toFixed(1)} BPM)` : ''),
  )
}

const expected = 8 * 4 * 480
console.log(`expected end tick for 8 bars = ${expected}`)
