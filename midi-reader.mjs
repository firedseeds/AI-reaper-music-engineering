/**
 * Minimal Standard MIDI reader shared by the score exporters.
 *
 * The parser is deliberately literal (same logic as house-demo/check-midi.mjs,
 * which is known to read every track of these files): it walks each chunk and
 * returns note-on events. Every exporter quantises to a sixteenth grid, so note
 * durations are implied and pairing on/off is unnecessary.
 */

import { readFileSync } from 'node:fs'

export function readNoteOns(path) {
  const buf = readFileSync(path)

  const u32 = (o) => buf.readUInt32BE(o)
  const u16 = (o) => buf.readUInt16BE(o)

  if (buf.toString('latin1', 0, 4) !== 'MThd') throw new Error(`${path}: not a MIDI file`)
  const headerLen = u32(4)
  const ntrks = u16(10)

  let offset = 8 + headerLen
  const notes = []

  for (let t = 0; t < ntrks; t++) {
    if (buf.toString('latin1', offset, offset + 4) !== 'MTrk') {
      throw new Error(`${path}: track ${t} has a bad chunk header at ${offset}`)
    }
    const len = u32(offset + 4)
    let p = offset + 8
    const end = p + len
    let tick = 0
    let status = 0

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
      const b = buf[p]
      if (b === 0xff) {
        p++
        const type = buf[p++]
        const l = readVlq()
        p += l
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
      if (type === 0x90) {
        const pitch = buf[p++]
        const velocity = buf[p++]
        if (velocity > 0) notes.push({ start: tick, pitch, velocity })
      } else if (type === 0x80) {
        p += 2
      } else if (type === 0xc0 || type === 0xd0) {
        p += 1
      } else {
        p += 2
      }
    }

    offset = end
  }

  return notes
}
