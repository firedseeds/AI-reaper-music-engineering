/**
 * Renders the three classroom foley cues to WAV so REAPER can place them as
 * audio items. Run once; the output is committed with the project.
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeBell, makeChair, makeChalk, encodeWav } from './foley.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SR = 44100

const cues = [
  ['foley-bell.wav', makeBell(SR), 'distant chime'],
  ['foley-chair.wav', makeChair(SR), 'chair scrape'],
  ['foley-chalk.wav', makeChalk(SR), 'chalk on the board'],
]

for (const [file, samples, label] of cues) {
  writeFileSync(join(HERE, file), encodeWav(samples, SR))
  console.log(`  ${file}: ${(samples.length / SR).toFixed(2)}s (${label})`)
}
