/**
 * Classroom foley, synthesised rather than sampled so the project stays
 * self-contained: a distant chime, a chair scraping, and chalk on a board.
 * Each function returns a mono Float32Array at the given sample rate.
 */

const TAU = Math.PI * 2

function onePoleLowpass(input, cutoff, sampleRate) {
  const out = new Float32Array(input.length)
  const coef = 1 - Math.exp((-TAU * cutoff) / sampleRate)
  let y = 0
  for (let i = 0; i < input.length; i++) {
    y += coef * (input[i] - y)
    out[i] = y
  }
  return out
}

function onePoleHighpass(input, cutoff, sampleRate) {
  const out = new Float32Array(input.length)
  const coef = 1 - Math.exp((-TAU * cutoff) / sampleRate)
  let y = 0
  let prev = 0
  for (let i = 0; i < input.length; i++) {
    y += coef * (input[i] - y)
    out[i] = input[i] - y
    prev = input[i]
  }
  return out
}

/** Distant school chime: inharmonic partials with a long, soft tail. */
export function makeBell(sampleRate, seconds = 3.4) {
  const n = Math.floor(seconds * sampleRate)
  const out = new Float32Array(n)
  const partials = [
    [1046.5, 0.5, 1.6],
    [1568.0, 0.28, 1.1],
    [2093.0, 0.18, 0.8],
    [2637.0, 0.1, 0.55],
    [3136.0, 0.06, 0.4],
  ]
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    let s = 0
    for (const [freq, amp, decay] of partials) {
      s += Math.sin(TAU * freq * t) * amp * Math.exp(-t / decay)
    }
    const attack = Math.min(1, t / 0.004)
    out[i] = s * attack
  }
  // "far away": roll off the top and keep it quiet
  const filtered = onePoleLowpass(out, 2200, sampleRate)
  for (let i = 0; i < n; i++) filtered[i] *= 0.32
  return filtered
}

/** Chair dragged across the floor: noisy band with a slow swell. */
export function makeChair(sampleRate, seconds = 1.1) {
  const n = Math.floor(seconds * sampleRate)
  const raw = new Float32Array(n)
  let lp = 0
  let hp = 0
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const noise = Math.random() * 2 - 1
    lp += 0.08 * (noise - lp)
    hp = lp - hp * 0.0
    // a wobbling resonance makes it read as wood on a hard floor
    const wobble = 1 + 0.35 * Math.sin(TAU * 7.5 * t)
    const env = Math.sin(Math.PI * Math.min(1, t / seconds)) ** 2
    raw[i] = lp * wobble * env
  }
  const marked = onePoleHighpass(raw, 260, sampleRate)
  const shaped = onePoleLowpass(marked, 1600, sampleRate)
  for (let i = 0; i < n; i++) shaped[i] *= 0.5
  return shaped
}

/** Chalk: several short, bright scratches. */
export function makeChalk(sampleRate, seconds = 1.3) {
  const n = Math.floor(seconds * sampleRate)
  const out = new Float32Array(n)
  const taps = [0.0, 0.18, 0.42, 0.63, 0.95]
  for (const start of taps) {
    const begin = Math.floor(start * sampleRate)
    const len = Math.floor(0.09 * sampleRate)
    let prev = 0
    for (let i = 0; i < len && begin + i < n; i++) {
      const t = i / sampleRate
      const noise = Math.random() * 2 - 1
      const bright = noise - prev
      prev = noise
      const env = Math.exp(-t / 0.02) * (1 - Math.exp(-t / 0.002))
      out[begin + i] += bright * env * 0.16
    }
  }
  const shaped = onePoleHighpass(out, 1800, sampleRate)
  return shaped
}

/** 16-bit mono WAV. */
export function encodeWav(samples, sampleRate) {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    data.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'latin1')
  header.write('fmt ', 12, 'latin1')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'latin1')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

