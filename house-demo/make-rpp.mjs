/**
 * Write the REAPER project for the five-minute house arrangement.
 *
 * Positions come from timeline.json (emitted by make-house.mjs), so the sample
 * beds and transitions follow the section table instead of hard-coded bars.
 *
 * Seven MIDI tracks plus sample tracks: pad bed, FX transitions, the stretched
 * jungle break, the clap layer, and two TTS vocal phrases.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const rppPath = join(here, 'house-124-fmin.rpp')
const win = p => relative(here, p).replaceAll('/', '\\\\')

const timeline = JSON.parse(readFileSync(join(here, 'timeline.json'), 'utf8'))
const BARS = timeline.bars
const BAR = timeline.barSeconds
const BEAT = BAR / 4
const LENGTH = BARS * BAR

const section = (name) => {
  const found = timeline.sections.find(s => s.name === name)
  if (found === undefined) throw new Error(`no section named ${name}`)
  return found
}
const drops = timeline.sections.filter(s => s.kind === 'drop')
const at = (bar, offset = 0) => bar * BAR + offset

const PACK = 'blu-mar-ten-main'

function wavDuration(path) {
  const buf = readFileSync(path)
  if (buf.toString('latin1', 0, 4) !== 'RIFF') throw new Error(`${path} is not a RIFF file`)
  let offset = 12
  let byteRate = 0
  let dataSize = 0
  while (offset + 8 <= buf.length) {
    const id = buf.toString('latin1', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'fmt ') byteRate = buf.readUInt32LE(offset + 16)
    else if (id === 'data') { dataSize = size; break }
    offset += 8 + size + (size % 2)
  }
  if (byteRate === 0) throw new Error(`${path}: no fmt chunk`)
  return dataSize / byteRate
}

const local = (name) => {
  const full = join(here, name)
  if (!existsSync(full)) throw new Error(`missing ${name}`)
  return { path: full, duration: wavDuration(full) }
}
const packed = (rel) => {
  const full = join(here, PACK, rel)
  if (!existsSync(full)) throw new Error(`missing sample: ${rel}`)
  return { path: full, duration: wavDuration(full) }
}

const pad = packed('Pads/Wash_Pad_7A.wav')
const riser = packed('FX/Aura_Rise_3A.wav')
const boom = packed('FX/Aura_Boom_4A.wav')
const clap = local('clap.wav')
const brk = local('break-124.wav')
const vox1 = local('vox1.wav')
const vox2 = local('vox2.wav')

const guid = () => {
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, '0')
  return `{${h()}${h()}-${h()}-${h()}-${h()}-${h()}${h()}${h()}}`
}

function itemBlock(spec) {
  return `    <ITEM
      POSITION ${spec.position.toFixed(6)}
      SNAPOFFS 0
      LENGTH ${spec.length.toFixed(6)}
      LOOP ${spec.loop === false ? 0 : 1}
      ALLTAKES 0
      FADEIN 1 0 0 1 0 0 0
      FADEOUT 1 0 0 1 0 0 0
      MUTE 0 0
      SEL 0
      IGUID ${guid()}
      IID 1
      NAME "${spec.name}"
      VOLPAN ${spec.gain ?? 1} 0 1 -1
      SOFFS 0
      PLAYRATE 1 1 0 -1 0 0.0025
      CHANMODE 0
      GUID ${guid()}
${spec.source}
    >
`
}

const midiSource = file => `      <SOURCE MIDI
        FILE "${win(file)}"
      >
`
const waveSource = file => `      <SOURCE WAVE
        FILE "${win(file)}"
      >
`

function trackBlock(spec) {
  // Every track ends with the build filter. A linear filter commutes with
  // summing, so filtering each stem individually and mixing in Audacity gives
  // the same result as filtering the master — and the build survives stem
  // export, which a master-only effect would not.
  const chain = []
  if (spec.js !== undefined) {
    chain.push(`      <JS ${spec.js} ""`)
    chain.push('      >')
  }
  chain.push('      <JS DSH/build-filter.jsfx ""')
  chain.push('      >')

  const fxs = `    <FXCHAIN
      SHOW 0
      LASTSEL 0
      DOCKED 0
      BYPASS 0 0 0
${chain.join('\n')}
    >
`
  return `  <TRACK
    NAME "${spec.name}"
    PEAKCOL ${spec.color}
    BEAT -1
    AUTOMODE 0
    VOLPAN ${spec.volume ?? 1} ${spec.pan ?? 0} -1 -1 ${spec.volume ?? 1}
    MUTESOLO 0 0 0
    IPHASE 0
    PLAYOFFS 0 1
    ISBUS 0 0
    BUSCOMP 0 0 0 0 0
    SHOWINMIX 1 0.6667 0.5 1 0.5 0 0 0
    FREEMODE 0
    SEL 0
    REC 0 0 1 0 0 0 0 0
    VU 2
    TRACKHEIGHT 0 0 0 0 0 0
    INQ 0 0 0 0.5 100 0 0 100
    NCHAN 2
    FX 1
    TRACKID ${guid()}
    PERF 0
    MIDIOUT -1
    MAINSEND 1 0
${fxs}${spec.items.join('')}  >
`
}

const longItem = (name, midi) => itemBlock({
  position: 0,
  length: LENGTH,
  name,
  source: midiSource(join(here, midi)),
})

// --- pad: a bed under every section, quieter inside the drops ------------
const padItems = timeline.sections.map((s) => {
  const gain = s.kind === 'drop' ? 0.15 : s.kind === 'break' ? 0.30 : 0.26
  return itemBlock({
    position: at(s.startBar),
    length: s.bars * BAR,
    name: `pad ${s.name}`,
    gain,
    source: waveSource(pad.path),
  })
})

// --- risers and impacts: one pair per drop ------------------------------
const fxItems = []
for (const drop of drops) {
  fxItems.push(itemBlock({
    position: at(drop.startBar) - riser.duration,
    length: riser.duration,
    name: `riser ${drop.name}`,
    gain: 0.48,
    source: waveSource(riser.path),
  }))
  fxItems.push(itemBlock({
    position: at(drop.startBar),
    length: boom.duration,
    name: `impact ${drop.name}`,
    gain: 0.42,
    source: waveSource(boom.path),
  }))
}

// --- clap on 2 and 4 through every drop --------------------------------
const clapItems = []
for (const drop of drops) {
  for (let i = 0; i < drop.bars; i++) {
    for (const beat of [1, 3]) {
      clapItems.push(itemBlock({
        position: at(drop.startBar + i) + beat * BEAT,
        length: clap.duration,
        name: 'clap',
        source: waveSource(clap.path),
      }))
    }
  }
}

// --- jungle break under the break section ------------------------------
const breakSection = section('break')
const breakItems = [
  itemBlock({
    position: at(breakSection.startBar),
    length: breakSection.bars * BAR,
    name: 'jungle break',
    gain: 0.34,
    source: waveSource(brk.path),
  }),
]

// --- TTS vocals over the vocal section --------------------------------
const vocalSection = section('vocal')
const vocalItems = [
  itemBlock({
    position: at(vocalSection.startBar),
    length: vox1.duration,
    name: 'vox1',
    gain: 0.85,
    source: waveSource(vox1.path),
  }),
  itemBlock({
    position: at(vocalSection.startBar + 8),
    length: vox2.duration,
    name: 'vox2',
    gain: 0.8,
    source: waveSource(vox2.path),
  }),
]

const rpp = `<REAPER_PROJECT 0.1 "7.63/win64" 1760000000
  RIPPLE 0
  GROUPOVERRIDE 0 0 0
  AUTOXFADE 1
  ENVATTACH 0
  POOLEDENVATTACH 0
  MIXERUIFLAGS 11 48
  PEAKGAIN 1
  FEEDBACK 0
  PANLAW 1
  PROJOFFS 0 0 0
  MAXPROJLEN 0 600
  GRID 3199 8 1 8 1 0 0 0
  TIMEMODE 1 5 -1 30 0 0 -1
  VIDEO_CONFIG 0 0 256
  PANMODE 3
  CURSOR 0
  ZOOM 100 0 0
  VZOOMEX 6 0
  USE_REC_CFG 0
  RECMODE 1
  SMPTESYNC 0 30 100 40 1000 300 0 0 1 0 0
  LOOP 0
  LOOPGRAN 0 4
  RECORD_PATH "" ""
  <RECORD_CFG
  >
  <APPLYFX_CFG
  >
  RENDER_FILE ""
  RENDER_PATTERN "house-124-fmin"
  RENDER_FMT 0 2 0
  RENDER_1X 0
  RENDER_RANGE 1 0 0 18 1000
  RENDER_RESAMPLE 3 0 1
  RENDER_ADDTOPROJ 0
  RENDER_STEMS 0
  RENDER_DITHER 0
  TIMELOCKMODE 1
  TEMPO ${timeline.bpm} 4 4
  PLAYRATE 1 1 0 -1 0 0.0025
  SELECTION 0 0
  MASTERAUTOMODE 0
  MASTERTRACKHEIGHT 0 0
  MASTERPEAKCOL 16576
  MASTERMUTESOLO 0
  MASTERTRACKVIEW 0 0.6667 0.5 0.5 0 0 0 0 0 0 0 0 0
  <MASTERFXLIST
  >
  MASTER_VOLUME 1 0 -1 -1 1
  MASTER_PANMODE 3
  MASTER_FX 1
  MASTER_SEL 0
${trackBlock({ name: 'Drums - MT-PowerDrumKit', color: 16624256, items: [longItem('Drums', 'house-drums.mid')] })}
${trackBlock({ name: 'Bass - Surge XT', color: 16750848, items: [longItem('Bass', 'house-bass.mid')] })}
${trackBlock({ name: 'Stabs - Surge XT', color: 8453888, items: [longItem('Stabs', 'house-stabs.mid')] })}
${trackBlock({ name: 'Power Chords - Ample LP', color: 8388736, items: [longItem('Power', 'house-power.mid')] })}
${trackBlock({ name: 'Penta Lead - Surge XT', color: 16776960, items: [longItem('Lead', 'house-lead.mid')] })}
${trackBlock({ name: 'Funk Clav - Surge XT', color: 16753920, items: [longItem('Clav', 'house-clav.mid')] })}
${trackBlock({ name: 'Jazz Gtr - Ample LP', color: 11776947, items: [longItem('Jazz Gtr - Ample LP', 'house-jazz.mid')] })}
${trackBlock({ name: 'Muted Gtr - Ample LP', color: 8421504, js: 'DSH/muted-eq.jsfx', items: [longItem('Muted Gtr - Ample LP', 'house-gtr.mid')] })}
${trackBlock({ name: 'Clap (sample)', color: 16711680, items: clapItems })}
${trackBlock({ name: 'Pad (pack)', color: 3342387, items: padItems })}
${trackBlock({ name: 'FX (pack)', color: 13382400, items: fxItems })}
${trackBlock({ name: 'Break (pack)', color: 4473924, items: breakItems })}
${trackBlock({ name: 'Vocal (TTS)', color: 10027136, items: vocalItems })}
>
`

writeFileSync(rppPath, rpp, 'utf8')
console.log(`wrote ${rppPath}`)
console.log(`bars=${BARS} length=${LENGTH.toFixed(1)}s claps=${clapItems.length} fx=${fxItems.length} pads=${padItems.length}`)






