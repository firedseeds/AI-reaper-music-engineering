/**
 * Render the generated sketch to a WAV preview with a small built-in synth.
 * This is a sketch renderer, not a substitute for MT-PowerDrumKit + Surge XT:
 * it exists so the arrangement can be heard without opening a DAW.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 44100
const here = dirname(fileURLToPath(import.meta.url))
const midiPath = join(here, 'house-124-fmin.mid')
const wavPath = join(here, 'house-124-fmin-preview.wav')

// ------------------------------------------------------------------ midi read

const buf = readFileSync(midiPath)
const u16 = o => buf.readUInt16BE(o)
const u32 = o => buf.readUInt32BE(o)
const ppq = u16(12)
const ntrks = u16(10)
const tempo = 483871
const secPerTick = tempo / 1e6 / ppq

const notes = []
{
  let offset = 8 + u32(4)
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
        p++
        const l = readVlq()
        p += l
        continue
      }
      if (b & 0x80) { status = b; p++ }
      const type = status & 0xf0
      const ch = status & 0x0f
      if (type === 0x90) {
        const pitch = buf[p++]
        const vel = buf[p++]
        if (vel > 0) open.set(pitch, { tick, vel, ch })
        else {
          const on = open.get(pitch)
          if (on) { notes.push({ ...on, pitch, dur: tick - on.tick }); open.delete(pitch) }
        }
      } else if (type === 0x80) {
        const pitch = buf[p++]
        p++
        const on = open.get(pitch)
        if (on) { notes.push({ ...on, pitch, dur: tick - on.tick }); open.delete(pitch) }
        void ch
      } else if (type === 0xc0 || type === 0xd0) p += 1
      else p += 2
    }
    offset = end
  }
}

// -------------------------------------------------------------------- synth

const lastTick = Math.max(...notes.map(n => n.tick + n.dur))
const duration = lastTick * secPerTick + 0.8
const frames = Math.ceil(duration * SR)
const L = new Float32Array(frames)
const R = new Float32Array(frames)

const hz = pitch => 440 * Math.pow(2, (pitch - 69) / 12)

function pan(gain, p) {
  return [gain * Math.sqrt((1 - p) / 2), gain * Math.sqrt((1 + p) / 2)]
}

/** Clavinet: bright, percussive, very short — the funk "chank". */
function addClav(start, durSamples, pitch, vel) {
  const g = (vel / 127) * 0.09
  const f = hz(pitch)
  const n = Math.min(durSamples + Math.floor(0.09 * SR), frames - start)
  let phase = 0
  let lp = 0
  const coef = 1 - Math.exp((-2 * Math.PI * 2400) / SR)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    phase += f / SR
    if (phase >= 1) phase -= 1
    const square = phase < 0.5 ? 1 : -1
    lp += coef * (square - lp)
    const env = Math.min(1, i / (0.001 * SR)) * Math.exp(-t / 0.045)
    const s = lp * env * g
    L[start + i] += s * 0.75
    R[start + i] += s
  }
}

function addKick(start, vel) {
  const g = (vel / 127) * 0.95
  const n = Math.floor(0.42 * SR)
  let phase = 0
  for (let i = 0; i < n && start + i < frames; i++) {
    const t = i / SR
    const freq = 45 + 95 * Math.exp(-t / 0.035) // pitch drop
    phase += (2 * Math.PI * freq) / SR
    const amp = Math.exp(-t / 0.11) * (1 - Math.exp(-t / 0.002))
    const s = Math.sin(phase) * amp * g
    L[start + i] += s
    R[start + i] += s
  }
}

function addClap(start, vel) {
  const g = (vel / 127) * 0.45
  const n = Math.floor(0.28 * SR)
  let prev = 0
  for (let i = 0; i < n && start + i < frames; i++) {
    const t = i / SR
    // three short noise bursts then a tail, band-limited by a first difference
    const burst = Math.exp(-((t % 0.011) / 0.004)) * (t < 0.033 ? 1 : 0)
    const tail = Math.exp(-t / 0.09)
    const noise = Math.random() * 2 - 1
    const hp = noise - prev
    prev = noise
    const s = hp * (burst * 0.8 + tail * 0.25) * g
    L[start + i] += s
    R[start + i] += s * 0.95
  }
}

function addHat(start, vel, open) {
  const g = (vel / 127) * (open ? 0.28 : 0.2)
  const n = Math.floor((open ? 0.3 : 0.07) * SR)
  let prev = 0
  for (let i = 0; i < n && start + i < frames; i++) {
    const t = i / SR
    const noise = Math.random() * 2 - 1
    const hp = noise - prev
    prev = noise
    const s = hp * Math.exp(-t / (open ? 0.12 : 0.025)) * g
    L[start + i] += s * 0.9
    R[start + i] += s
  }
}

function addBass(start, durSamples, pitch, vel) {
  const g = (vel / 127) * 0.5
  const f = hz(pitch)
  const n = Math.min(durSamples + Math.floor(0.12 * SR), frames - start)
  let phase = 0
  let lp = 0
  const coef = 1 - Math.exp((-2 * Math.PI * 420) / SR) // gentle lowpass
  for (let i = 0; i < n; i++) {
    phase += f / SR
    if (phase >= 1) phase -= 1
    const saw = 2 * phase - 1
    lp += coef * (saw - lp)
    const env = Math.min(1, i / (0.004 * SR)) * Math.exp(-i / (0.18 * SR))
    const s = Math.tanh(lp * 1.6) * env * g
    L[start + i] += s
    R[start + i] += s
  }
}

function addStab(start, durSamples, pitch, vel) {
  const g = (vel / 127) * 0.12
  const f = hz(pitch)
  const n = Math.min(durSamples + Math.floor(0.5 * SR), frames - start)
  const [gl, gr] = pan(g, 0.25)
  let p1 = 0
  let p2 = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    p1 += (f * 1.002) / SR
    p2 += (f * 0.998) / SR
    if (p1 >= 1) p1 -= 1
    if (p2 >= 1) p2 -= 1
    const s1 = 2 * p1 - 1
    const s2 = 2 * p2 - 1
    const partial = Math.sin(2 * Math.PI * f * 2 * t) * 0.25 + Math.sin(2 * Math.PI * f * 3 * t) * 0.12
    const env = Math.min(1, i / (0.003 * SR)) * Math.exp(-t / 0.22)
    const s = (s1 + s2) * 0.35 + partial
    L[start + i] += s * env * gl
    R[start + i] += s * env * gr
  }
}

/** Power chord: a hard-clipped saw, short and mid-focused. */
function addPower(start, durSamples, pitch, vel) {
  const g = (vel / 127) * 0.14
  const f = hz(pitch)
  const n = Math.min(durSamples + Math.floor(0.2 * SR), frames - start)
  let phase = 0
  let lp = 0
  const coef = 1 - Math.exp((-2 * Math.PI * 1600) / SR)
  for (let i = 0; i < n; i++) {
    phase += f / SR
    if (phase >= 1) phase -= 1
    const saw = 2 * phase - 1
    const driven = Math.tanh(saw * 5)
    lp += coef * (driven - lp)
    const env = Math.min(1, i / (0.002 * SR)) * Math.exp(-i / (0.14 * SR))
    const s = lp * env * g
    L[start + i] += s * 0.95
    R[start + i] += s * 0.85
  }
}

/** Lead: square plus a detuned saw, tiny delayed vibrato. */
function addLead(start, durSamples, pitch, vel) {
  const g = (vel / 127) * 0.16
  const f = hz(pitch)
  const n = Math.min(durSamples + Math.floor(0.4 * SR), frames - start)
  let phase = 0
  let phase2 = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const vib = 1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t / 0.12)
    phase += (f * 1.003 * vib) / SR
    phase2 += (f * 0.997 * vib) / SR
    if (phase >= 1) phase -= 1
    if (phase2 >= 1) phase2 -= 1
    const square = phase < 0.5 ? 1 : -1
    const saw = 2 * phase2 - 1
    const env = Math.min(1, i / (0.005 * SR)) * Math.exp(-t / 0.28)
    const s = (square * 0.45 + saw * 0.35) * env * g
    L[start + i] += s * 0.8
    R[start + i] += s
  }
}

/** Palm-muted guitar: damped body, pick click, very short decay. */
function addMuted(start, durSamples, pitch, vel) {
  const g = (vel / 127) * 0.12
  const f = hz(pitch)
  const n = Math.min(durSamples + Math.floor(0.08 * SR), frames - start)
  let phase = 0
  let lp = 0
  // two cascaded one-poles -> steeper lowpass, the "blanket over the strings" sound
  let lp2 = 0
  const coef = 1 - Math.exp((-2 * Math.PI * 700) / SR)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    phase += f / SR
    if (phase >= 1) phase -= 1
    const saw = 2 * phase - 1
    lp += coef * (saw - lp)
    lp2 += coef * (lp - lp2)
    const click = t < 0.004 ? (Math.random() * 2 - 1) * 0.6 : 0
    const env = Math.min(1, i / (0.0015 * SR)) * Math.exp(-t / 0.035)
    const s = Math.tanh((lp2 * 2.2 + click) * 1.4) * env * g
    L[start + i] += s * 0.9
    R[start + i] += s * 0.95
  }
}

for (const note of notes) {
  const start = Math.round(note.tick * secPerTick * SR)
  const durSamples = Math.max(1, Math.round(note.dur * secPerTick * SR))
  if (note.ch === 9) {
    if (note.pitch === 36) addKick(start, note.vel)
    else if (note.pitch === 38 || note.pitch === 39) addClap(start, note.vel)
    else if (note.pitch === 42) addHat(start, note.vel, false)
    else if (note.pitch === 46) addHat(start, note.vel, true)
  } else if (note.ch === 0) {
    addBass(start, durSamples, note.pitch, note.vel)
  } else if (note.ch === 3) {
    addPower(start, durSamples, note.pitch, note.vel)
  } else if (note.ch === 4) {
    addLead(start, durSamples, note.pitch, note.vel)
  } else if (note.ch === 5 && note.pitch >= 30) {
    addMuted(start, durSamples, note.pitch, note.vel)
  } else if (note.ch === 2) {
    addClav(start, durSamples, note.pitch, note.vel)
  } else {
    addStab(start, durSamples, note.pitch, note.vel)
  }
}

// ---------------------------------------------------------------- soft clip + wav

let peak = 0
for (let i = 0; i < frames; i++) {
  L[i] = Math.tanh(L[i] * 1.15)
  R[i] = Math.tanh(R[i] * 1.15)
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

writeFileSync(wavPath, Buffer.concat([header, data]))
console.log(`wrote ${wavPath}`)
console.log(`notes=${notes.length} duration=${duration.toFixed(2)}s frames=${frames} peak=${peak.toFixed(2)}`)




