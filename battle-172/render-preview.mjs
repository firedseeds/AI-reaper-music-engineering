/**
 * Audio sketch of the battle theme. Drums, sub bass, chord slices and arp are
 * synthesised; the classroom cues are mixed in at four sparse points.
 *
 * Usage: node render-preview.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeBell, makeChair, makeChalk } from '../classroom-menu/foley.mjs'

const SR = 44100
const HERE = dirname(fileURLToPath(import.meta.url))
const TAU = Math.PI * 2

const buf = readFileSync(join(HERE, 'battle-172-amin.mid'))
const timeline = JSON.parse(readFileSync(join(HERE, 'timeline.json'), 'utf8'))

function readMidi() {
  const u16 = (o) => buf.readUInt16BE(o)
  const u32 = (o) => buf.readUInt32BE(o)
  const ntrks = u16(10)
  let offset = 8 + u32(4)
  const notes = []
  for (let t = 0; t < ntrks; t++) {
    const len = u32(offset + 4)
    let p = offset + 8
    const end = p + len
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
      if (b & 0x80) {
        status = b
        p++
      }
      const type = status & 0xf0
      const channel = status & 0x0f
      if (type === 0x90) {
        const pitch = buf[p++]
        const vel = buf[p++]
        if (vel > 0) open.set(pitch, { tick, vel, channel })
        else {
          const on = open.get(pitch)
          if (on) {
            notes.push({ start: on.tick, dur: tick - on.tick, pitch, vel: on.vel, channel })
            open.delete(pitch)
          }
        }
      } else if (type === 0x80) {
        const pitch = buf[p++]
        p++
        const on = open.get(pitch)
        if (on) {
          notes.push({ start: on.tick, dur: tick - on.tick, pitch, vel: on.vel, channel })
          open.delete(pitch)
        }
      } else if (type === 0xc0 || type === 0xd0) p += 1
      else p += 2
    }
    offset = end
  }
  return notes
}

const notes = readMidi()
const secPerTick = 60 / timeline.bpm / 480
const lastTick = Math.max(...notes.map((n) => n.start + n.dur))
const frames = Math.ceil((lastTick * secPerTick + 2) * SR)
const L = new Float32Array(frames)
const R = new Float32Array(frames)
const hz = (pitch) => 440 * Math.pow(2, (pitch - 69) / 12)

function kick(start, vel) {
  const g = (vel / 127) * 0.85
  const n = Math.floor(0.22 * SR)
  let phase = 0
  for (let i = 0; i < n && start + i < frames; i++) {
    const t = i / SR
    const f = 48 + 110 * Math.exp(-t / 0.028)
    phase += (TAU * f) / SR
    const s = Math.sin(phase) * Math.exp(-t / 0.09) * g
    L[start + i] += s
    R[start + i] += s
  }
}

function snare(start, vel) {
  const g = (vel / 127) * 0.5
  const n = Math.floor(0.2 * SR)
  let prev = 0
  for (let i = 0; i < n && start + i < frames; i++) {
    const t = i / SR
    const noise = Math.random() * 2 - 1
    const hp = noise - prev
    prev = noise
    const body = Math.sin(TAU * 185 * t) * 0.55
    const s = (hp * 0.75 + body) * Math.exp(-t / 0.045) * g
    L[start + i] += s
    R[start + i] += s
  }
}

function hat(start, vel, decay = 0.045) {
  const g = (vel / 127) * 0.18
  const n = Math.floor(decay * 6 * SR)
  let prev = 0
  for (let i = 0; i < n && start + i < frames; i++) {
    const t = i / SR
    const noise = Math.random() * 2 - 1
    const hp = noise - prev
    prev = noise
    const s = hp * Math.exp(-t / decay) * g
    L[start + i] += s * 0.9
    R[start + i] += s
  }
}

function cymbal(start, vel) {
  const g = (vel / 127) * 0.14
  const n = Math.floor(1.1 * SR)
  let prev = 0
  for (let i = 0; i < n && start + i < frames; i++) {
    const t = i / SR
    const noise = Math.random() * 2 - 1
    const hp = noise - prev
    prev = noise
    const s = hp * Math.exp(-t / 0.35) * g
    L[start + i] += s * 0.9
    R[start + i] += s
  }
}

/** Sub bass: a clean sine an octave below, with a soft click. */
function sub(start, duration, pitch, vel) {
  const g = (vel / 127) * 0.55
  const f = hz(pitch - 12)
  const n = Math.min(Math.floor((duration + 0.06) * SR), frames - start)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    phase += (TAU * f) / SR
    const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.5)
    const s = Math.sin(phase) * env * g
    L[start + i] += s
    R[start + i] += s
  }
}

/** Chord slice: short Rhodes-ish stab. */
function stab(start, duration, pitch, vel) {
  const g = (vel / 127) * 0.17
  const f = hz(pitch)
  const n = Math.min(Math.floor((duration + 0.25) * SR), frames - start)
  let phase = 0
  let mod = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const index = 1.6 * Math.exp(-t / 0.05)
    mod += (TAU * f * 2) / SR
    phase += (TAU * f) / SR
    const s = Math.sin(phase + index * Math.sin(mod))
    const env = Math.min(1, t / 0.003) * Math.exp(-t / 0.12)
    const v = s * env * g
    L[start + i] += v * 0.9
    R[start + i] += v
  }
}

/** Arp: a thin bell/square layer for the B section. */
function arpNote(start, duration, pitch, vel) {
  const g = (vel / 127) * 0.11
  const f = hz(pitch)
  const n = Math.min(Math.floor((duration + 0.2) * SR), frames - start)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    phase += (TAU * f) / SR
    const square = Math.sign(Math.sin(phase)) * 0.5 + Math.sin(phase) * 0.5
    const env = Math.min(1, t / 0.002) * Math.exp(-t / 0.11)
    const v = square * env * g
    L[start + i] += v * 0.75
    R[start + i] += v
  }
}

for (const note of notes) {
  const start = Math.round(note.start * secPerTick * SR)
  const duration = Math.max(1, Math.round(note.dur * secPerTick * SR)) / SR
  if (note.channel === 9) {
    if (note.pitch === 36) kick(start, note.vel)
    else if (note.pitch === 38) snare(start, note.vel)
    else if (note.pitch === 42) hat(start, note.vel)
    else if (note.pitch === 49) cymbal(start, note.vel)
  } else if (note.channel === 0) sub(start, duration, note.pitch, note.vel)
  else if (note.channel === 1) stab(start, duration, note.pitch, note.vel)
  else if (note.channel === 2) arpNote(start, duration, note.pitch, note.vel)
}

// --- sparse classroom cues ------------------------------------------------
function mix(samples, atSeconds, gain) {
  const start = Math.round(atSeconds * SR)
  for (let i = 0; i < samples.length; i++) {
    if (start + i >= frames) break
    L[start + i] += samples[i] * gain
    R[start + i] += samples[i] * gain * 0.9
  }
}

const barSeconds = timeline.barSeconds
const at = (bar) => bar * barSeconds
mix(makeChair(SR), at(8), 0.5)
mix(makeBell(SR), at(24), 0.55)
mix(makeChalk(SR), at(40), 0.45)
mix(makeChair(SR), at(56), 0.4)

// --- master ---------------------------------------------------------------
// a gentle 10 kHz low-pass: the hats and cue hits are bright on their own and
// the brief asks for a soft top end
const coef = 1 - Math.exp((-TAU * 10000) / SR)
let lpL = 0
let lpR = 0
let peak = 0
for (let i = 0; i < frames; i++) {
  lpL += coef * (L[i] - lpL)
  lpR += coef * (R[i] - lpR)
  L[i] = Math.tanh(lpL * 1.15)
  R[i] = Math.tanh(lpR * 1.15)
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
}
const norm = peak > 0 ? 0.88 / peak : 1

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

writeFileSync(join(HERE, 'battle-preview.wav'), Buffer.concat([header, data]))
console.log(`notes=${notes.length} duration=${(frames / SR).toFixed(1)}s peak=${peak.toFixed(2)}`)

