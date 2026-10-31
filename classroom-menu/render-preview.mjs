/**
 * Audio sketch of the menu theme: reads the MIDI, renders a music box, Rhodes,
 * pad, bass and shaker with a small built-in synth, then drops the three foley
 * cues in at the section changes.
 *
 * This is not the final sound — it exists so the arrangement can be judged
 * without installing any plugins. Usage: node render-preview.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 44100
const HERE = dirname(fileURLToPath(import.meta.url))
const TAU = Math.PI * 2

const buf = readFileSync(join(HERE, 'menu-96-amin.mid'))
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
const frames = Math.ceil((lastTick * secPerTick + 4) * SR)
const L = new Float32Array(frames)
const R = new Float32Array(frames)

const hz = (pitch) => 440 * Math.pow(2, (pitch - 69) / 12)

function onePoleLowpass(input, cutoff) {
  const out = new Float32Array(input.length)
  const coef = 1 - Math.exp((-TAU * cutoff) / SR)
  let y = 0
  for (let i = 0; i < input.length; i++) {
    y += coef * (input[i] - y)
    out[i] = y
  }
  return out
}

/** Music box: a few inharmonic partials and a fast, gentle decay. */
function musicBox(start, duration, pitch, vel) {
  const g = (vel / 127) * 0.25
  const f = hz(pitch)
  const n = Math.min(Math.floor((duration + 2.4) * SR), frames - start)
  const partials = [
    [1, 1, 1.1],
    [2, 0.32, 0.55],
    [3.01, 0.16, 0.3],
    [4.2, 0.07, 0.18],
  ]
  for (let i = 0; i < n; i++) {
    const t = i / SR
    let s = 0
    for (const [ratio, amp, decay] of partials) {
      s += Math.sin(TAU * f * ratio * t) * amp * Math.exp(-t / decay)
    }
    const attack = Math.min(1, t / 0.003)
    const v = s * attack * g * 0.5
    L[start + i] += v * 0.95
    R[start + i] += v
  }
}

/** Rhodes: sine carrier with a decaying 2:1 modulator. */
function rhodes(start, duration, pitch, vel) {
  const g = (vel / 127) * 0.3
  const f = hz(pitch)
  const n = Math.min(Math.floor((duration + 1.2) * SR), frames - start)
  let phase = 0
  let modPhase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const index = 2.2 * Math.exp(-t / 0.12)
    modPhase += (TAU * f * 2) / SR
    phase += (TAU * f) / SR
    const s = Math.sin(phase + index * Math.sin(modPhase))
    const env = Math.min(1, t / 0.006) * Math.exp(-t / 0.9)
    const v = s * env * g
    L[start + i] += v * 0.9
    R[start + i] += v
  }
}

/** Pad: three slightly detuned saws through a dark lowpass. */
function pad(start, duration, pitch, vel) {
  const g = (vel / 127) * 0.16
  const f = hz(pitch)
  const n = Math.min(Math.floor((duration + 2.5) * SR), frames - start)
  const buffer = new Float32Array(n)
  const detune = [-0.004, 0, 0.004]
  const phases = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = 0; k < 3; k++) {
      phases[k] += (f * (1 + detune[k])) / SR
      if (phases[k] >= 1) phases[k] -= 1
      s += 2 * phases[k] - 1
    }
    buffer[i] = s / 3
  }
  const dark = onePoleLowpass(buffer, 900)
  const attack = 0.5
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const env = Math.min(1, t / attack) * Math.min(1, Math.max(0, (n / SR - t) / 1.2))
    const v = dark[i] * env * g
    L[start + i] += v * 0.8
    R[start + i] += v * 1.0
  }
}

/** Bass: near-sine with a soft second harmonic. */
function bass(start, duration, pitch, vel) {
  const g = (vel / 127) * 0.3
  const f = hz(pitch)
  const n = Math.min(Math.floor((duration + 0.8) * SR), frames - start)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    phase += (TAU * f) / SR
    const s = Math.sin(phase) + 0.18 * Math.sin(phase * 2)
    const env = Math.min(1, t / 0.02) * Math.exp(-t / 1.8)
    const v = s * env * g
    L[start + i] += v
    R[start + i] += v
  }
}

/** Shaker: a short burst of high noise. */
function shaker(start, vel) {
  const g = (vel / 127) * 0.12
  const n = Math.floor(0.05 * SR)
  let prev = 0
  for (let i = 0; i < n && start + i < frames; i++) {
    const t = i / SR
    const noise = Math.random() * 2 - 1
    const bright = noise - prev
    prev = noise
    const env = Math.exp(-t / 0.012)
    const v = bright * env * g * 0.5
    L[start + i] += v * 0.85
    R[start + i] += v
  }
}

for (const note of notes) {
  const start = Math.round(note.start * secPerTick * SR)
  const duration = Math.max(1, Math.round(note.dur * secPerTick * SR))
  if (note.channel === 0) musicBox(start, duration / SR, note.pitch, note.vel)
  else if (note.channel === 1) rhodes(start, duration / SR, note.pitch, note.vel)
  else if (note.channel === 2) pad(start, duration / SR, note.pitch, note.vel)
  else if (note.channel === 3) bass(start, duration / SR, note.pitch, note.vel)
  else if (note.channel === 4) shaker(start, note.vel)
}

// --- foley ----------------------------------------------------------------
function readWav(path) {
  const b = readFileSync(path)
  let offset = 12
  let byteRate = 0
  let dataStart = 0
  let dataLen = 0
  while (offset + 8 <= b.length) {
    const id = b.toString('latin1', offset, offset + 4)
    const size = b.readUInt32LE(offset + 4)
    if (id === 'fmt ') byteRate = b.readUInt32LE(offset + 16)
    else if (id === 'data') {
      dataStart = offset + 8
      dataLen = size
      break
    }
    offset += 8 + size + (size % 2)
  }
  const count = dataLen / 2
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = b.readInt16LE(dataStart + i * 2) / 32767
  return { samples: out, rate: byteRate / 2 }
}

function placeFoley(file, atSeconds, gain) {
  const { samples } = readWav(join(HERE, file))
  const start = Math.round(atSeconds * SR)
  for (let i = 0; i < samples.length; i++) {
    if (start + i >= frames) break
    L[start + i] += samples[i] * gain
    R[start + i] += samples[i] * gain * 0.92
  }
}

const barSeconds = timeline.barSeconds
const sectionBar = (name) => timeline.sections.find((s) => s.name === name).startBar * barSeconds
placeFoley('foley-chair.wav', sectionBar('A'), 0.9)
placeFoley('foley-chalk.wav', sectionBar('B'), 0.85)
placeFoley('foley-bell.wav', sectionBar('return'), 1.0)

// --- master ---------------------------------------------------------------
let peak = 0
for (let i = 0; i < frames; i++) {
  L[i] = Math.tanh(L[i] * 1.05)
  R[i] = Math.tanh(R[i] * 1.05)
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
}
const norm = peak > 0 ? 0.85 / peak : 1

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

writeFileSync(join(HERE, 'menu-preview.wav'), Buffer.concat([header, data]))
console.log(`notes=${notes.length} duration=${(frames / SR).toFixed(1)}s peak=${peak.toFixed(2)}`)
