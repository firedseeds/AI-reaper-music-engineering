/**
 * Build the REAPER project for the thrash sketch.
 *
 * Five tracks: double-tracked rhythm guitars panned hard left and right, bass,
 * lead, drums. A limiter sits on the master so the double-tracked guitars do
 * not clip the sum. Media paths are relative, so the folder is portable.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const rppPath = join(here, 'thrash-190-em.rpp')

const timeline = JSON.parse(readFileSync(join(here, 'timeline.json'), 'utf8'))
const BARS = timeline.bars
const BAR = timeline.barSeconds
const LENGTH = BARS * BAR

const win = (p) => {
  const rel = relative(here, p)
  return (rel.startsWith('.') ? p : rel).replaceAll('/', '\\')
}

const guid = () => {
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, '0')
  return `{${h()}${h()}-${h()}-${h()}-${h()}-${h()}${h()}${h()}}`
}

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

function audioItem(name, file, position) {
  const full = join(here, file)
  return `    <ITEM
      POSITION ${position.toFixed(6)}
      SNAPOFFS 0
      LENGTH ${wavDuration(full).toFixed(6)}
      LOOP 0
      ALLTAKES 0
      FADEIN 1 0 0 1 0 0 0
      FADEOUT 1 0 0 1 0 0 0
      MUTE 0 0
      SEL 0
      IGUID ${guid()}
      IID 1
      NAME "${name}"
      VOLPAN 1 0 1 -1
      SOFFS 0
      PLAYRATE 1 1 0 -1 0 0.0025
      CHANMODE 0
      GUID ${guid()}
      <SOURCE WAVE
        FILE "${win(full)}"
      >
    >
`
}

function itemBlock(spec) {
  return `    <ITEM
      POSITION 0
      SNAPOFFS 0
      LENGTH ${spec.length.toFixed(6)}
      LOOP 1
      ALLTAKES 0
      FADEIN 1 0 0 1 0 0 0
      FADEOUT 1 0 0 1 0 0 0
      MUTE 0 0
      SEL 0
      IGUID ${guid()}
      IID 1
      NAME "${spec.name}"
      VOLPAN 1 0 1 -1
      SOFFS 0
      PLAYRATE 1 1 0 -1 0 0.0025
      CHANMODE 0
      GUID ${guid()}
      <SOURCE MIDI
        FILE "${win(join(here, spec.midi))}"
      >
    >
`
}

function trackBlock(spec) {
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
${spec.items ?? itemBlock({ name: spec.name, midi: spec.midi, length: LENGTH })}  >
`
}

// --- vocal solo: four TTS shouts on the first bar of each 4-bar phrase ---
const vocalSection = timeline.sections.find(s => s.name === 'vocal')
const vocalItems = ['vox1.wav', 'vox2.wav', 'vox3.wav', 'vox4.wav']
  .map((file, i) => audioItem(`vox${i + 1}`, file, (vocalSection.startBar + i * 4) * BAR))
  .join('')

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
  RENDER_PATTERN "thrash-190-em"
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
${trackBlock({ name: 'Rhythm L - Ample LP', color: 8421504, midi: 'thrash-gtr-l.mid' })}
${trackBlock({ name: 'Rhythm R - Ample LP', color: 8421504, midi: 'thrash-gtr-r.mid' })}
${trackBlock({ name: 'Bass - Surge XT', color: 16750848, midi: 'thrash-bass.mid' })}
${trackBlock({ name: 'Lead - Ample LP', color: 16776960, midi: 'thrash-lead.mid' })}
${trackBlock({ name: "Vocal - TTS", color: 10027136, items: vocalItems })}
${trackBlock({ name: 'Drums - MT-PowerDrumKit', color: 16624256, midi: 'thrash-drums.mid' })}
>
`

writeFileSync(rppPath, rpp, 'utf8')
console.log(`wrote ${rppPath}`)
console.log(`bars=${BARS} length=${LENGTH.toFixed(1)}s`)




