/**
 * Rough audio preview for the thrash sketch: reads the combined MIDI and
 * renders drums, a distorted rhythm guitar, bass and lead with a small
 * built-in synth. Not a substitute for Ample LP + MT-PowerDrumKit, just enough
 * to hear the riffs and the arrangement.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 44100
const here = dirname(fileURLToPath(import.meta.url))
const buf = readFileSync(join(here, 'thrash-190-em.mid'))

const u16 = o => buf.readUInt16BE(o)
const u32 = o => buf.readUInt32BE(o)
const ppq = u16(12)
const ntrks = u16(10)
const tempo = 315789
const secPerTick = tempo / 1e6 / ppq

const notes = []
let offset = 8 + u32(4)
for (let t = 0; t < ntrks; t++) {
  const len = u32(offset + 4)
  let p = offset + 8
  const trackEnd = p + len
  let tick = 0
  let status = 0
  const open = new Map()
  const readVlq = () => {
    let v = 0
    for (;;) {
      const b = buf[p++]
      v = (v << 7) | (b & 0x7f)
      if ((b & 0x80) === 0) return v
    }
  }
  while (p < trackEnd) {
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
    if (b & 0x80) { status = b; p++ }
    const type = status & 0xf0
    const ch = status & 0x0f
    if (type === 0x90) {
      const pitch = buf[p++]
      const vel = buf[p++]
      if (vel > 0) open.set(pitch, { tick, vel, ch, pitch })
      else {
        const on = open.get(pitch)
        if (on) { notes.push({ ...on, dur: tick - on.tick }); open.delete(pitch) }
      }
    } else if (type === 0x80) {
      const pitch = buf[p++]
      p++
      const on = open.get(pitch)
      if (on) { notes.push({ ...on, dur: tick - on.tick }); open.delete(pitch) }
    } else if (type === 0xc0 || type === 0xd0) p += 1
    else p += 2
  }
  offset = trackEnd
}
const lastTick = Math.max(...notes.map(n => n.tick + n.dur))
const duration = lastTick * secPerTick + 1.2
const frames = Math.ceil(duration * SR)
const L = new Float32Array(frames)
const R = new Float32Array(frames)
const hz = pitch => 440 * Math.pow(2, (pitch - 69) / 12)

function kick(start, vel) {
  const g = (vel / 127) * 0.9
  const n = Math.floor(0.18 * SR)
  let phase = 0
  for (let i = 0; i < n && start + i < frames; i++) {
    const t = i / SR
    const f = 50 + 90 * Math.exp(-t / 0.02)
    phase += (2 * Math.PI * f) / SR
    const s = Math.sin(phase) * Math.exp(-t / 0.06) * g
    L[start + i] += s
    R[start + i] += s
  }
}

function snare(start, vel) {
  const g = (vel / 127) * 0.55
  const n = Math.floor(0.22 * SR)
  let prev = 0
  for (let i = 0; i < n && start + i < frames; i++) {
    const t = i / SR
    const noise = Math.random() * 2 - 1
    const hp = noise - prev
    prev = noise
    const body = Math.sin(2 * Math.PI * 190 * t) * 0.5
    const s = (hp * 0.8 + body) * Math.exp(-t / 0.05) * g
    L[start + i] += s
    R[start + i] += s
  }
}

function cymbal(start, vel, length) {
  const g = (vel / 127) * 0.16
  const n = Math.floor(length * SR)
  let prev = 0
  for (let i = 0; i < n && start + i < frames; i++) {
    const t = i / SR
    const noise = Math.random() * 2 - 1
    const hp = noise - prev
    prev = noise
    const s = hp * Math.exp(-t / (length * 0.35)) * g
    L[start + i] += s * 0.9
    R[start + i] += s
  }
}

function tom(start, vel, pitch) {
  const g = (vel / 127) * 0.5
  const n = Math.floor(0.2 * SR)
  const f0 = hz(pitch)
  let phase = 0
  for (let i = 0; i < n && start + i < frames; i++) {
    const t = i / SR
    phase += (2 * Math.PI * f0 * (1 + 0.4 * Math.exp(-t / 0.03))) / SR
    const s = Math.sin(phase) * Math.exp(-t / 0.07) * g
    L[start + i] += s
    R[start + i] += s
  }
}

/** Palm-muted power chord: hard-clipped saw, very short. */
function guitar(start, durSamples, pitch, vel, side) {
  const g = (vel / 127) * 0.11
  const f = hz(pitch)
  const n = Math.min(durSamples + Math.floor(0.03 * SR), frames - start)
  let phase = 0
  let lp = 0
  const coef = 1 - Math.exp((-2 * Math.PI * 2600) / SR)
  for (let i = 0; i < n; i++) {
    phase += f / SR
    if (phase >= 1) phase -= 1
    const saw = 2 * phase - 1
    const driven = Math.tanh(saw * 9)
    lp += coef * (driven - lp)
    const env = Math.min(1, i / (0.001 * SR)) * Math.exp(-i / (0.05 * SR))
    const s = lp * env * g
    if (side < 0) L[start + i] += s
    else R[start + i] += s
  }
}

function bass(start, durSamples, pitch, vel) {
  const g = (vel / 127) * 0.3
  const f = hz(pitch)
  const n = Math.min(durSamples + Math.floor(0.05 * SR), frames - start)
  let phase = 0
  let lp = 0
  const coef = 1 - Math.exp((-2 * Math.PI * 500) / SR)
  for (let i = 0; i < n; i++) {
    phase += f / SR
    if (phase >= 1) phase -= 1
    const saw = 2 * phase - 1
    lp += coef * (saw - lp)
    const env = Math.min(1, i / (0.004 * SR)) * Math.exp(-i / (0.25 * SR))
    const s = Math.tanh(lp * 2) * env * g
    L[start + i] += s
    R[start + i] += s
  }
}

function lead(start, durSamples, pitch, vel) {
  const g = (vel / 127) * 0.13
  const f = hz(pitch)
  const n = Math.min(durSamples + Math.floor(0.1 * SR), frames - start)
  let phase = 0
  let lp = 0
  const coef = 1 - Math.exp((-2 * Math.PI * 3200) / SR)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.8 * t)
    phase += (f * vib) / SR
    if (phase >= 1) phase -= 1
    const saw = 2 * phase - 1
    const driven = Math.tanh(saw * 12)
    lp += coef * (driven - lp)
    const env = Math.min(1, i / (0.003 * SR)) * Math.exp(-t / 0.3)
    const s = lp * env * g
    L[start + i] += s
    R[start + i] += s
  }
}

for (const note of notes) {
  const start = Math.round(note.tick * secPerTick * SR)
  const durSamples = Math.max(1, Math.round(note.dur * secPerTick * SR))
  if (note.ch === 9) {
    if (note.pitch === 36) kick(start, note.vel)
    else if (note.pitch === 38) snare(start, note.vel)
    else if (note.pitch === 49) cymbal(start, note.vel, 0.9)
    else if (note.pitch === 51) cymbal(start, note.vel, 0.12)
    else tom(start, note.vel, note.pitch)
  } else if (note.ch === 0) {
    guitar(start, durSamples, note.pitch, note.vel, -1)
  } else if (note.ch === 1) {
    guitar(start, durSamples, note.pitch, note.vel, 1)
  } else if (note.ch === 2) {
    bass(start, durSamples, note.pitch, note.vel)
  } else if (note.ch === 3) {
    lead(start, durSamples, note.pitch, note.vel)
  }
}

let peak = 0
for (let i = 0; i < frames; i++) {
  L[i] = Math.tanh(L[i] * 1.1)
  R[i] = Math.tanh(R[i] * 1.1)
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
}
const norm = peak > 0 ? 0.89 / peak : 1

const data = Buffer.alloc(frames * 4)
for (let i = 0; i < frames; i++) {
  data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * norm * 32767))), i * 4)
  data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * norm * 32767))), i * 4 + 2)
}

const header = Buffer.alloc(44)
header.write('RIFF', 0, 'latin1')
header.writeUInt32LE(36 + data.length, 4)
header.write('WAVE', 8, 'latin1')
header.write('fmt ', 12, 'latin1')
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(2, 22)
header.writeUInt32LE(SR, 24)
header.writeUInt32LE(SR * 4, 28)
header.writeUInt16LE(4, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36, 'latin1')
header.writeUInt32LE(data.length, 40)

writeFileSync(join(here, 'thrash-preview.wav'), Buffer.concat([header, data]))
console.log(`notes=${notes.length} duration=${duration.toFixed(1)}s peak=${peak.toFixed(2)}`)

