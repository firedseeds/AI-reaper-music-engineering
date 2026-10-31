/**
 * Build a Guitar Pro 7/8 score (.gp) from the house MIDI tracks.
 *
 * alphaTab's Gp7Exporter writes the native .gp format that GP8 saves, so the
 * file opens directly. The muted-guitar source carries Ample LP keyswitch notes
 * (MIDI 26); they are filtered out because they are articulation switches, not
 * pitches you can play.
 *
 * Usage: node make-gp7.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as at from '@coderline/alphatab'
import { readNoteOns } from '../midi-reader.mjs'

const { model, exporter, Settings } = at
const HERE = dirname(fileURLToPath(import.meta.url))
const PPQ = 480
const SIXTEENTH = PPQ / 4

const GUITAR = [64, 59, 55, 50, 45, 40]
const BASS = [43, 38, 33, 28]

/** Lowest fret wins; if that string is taken, try the next one that fits. */
function placements(pitch, tuning) {
  const out = []
  for (let i = 0; i < tuning.length; i++) {
    const fret = pitch - tuning[i]
    if (fret >= 0 && fret <= 24) out.push({ string: i + 1, fret })
  }
  return out.sort((a, b) => a.fret - b.fret)
}

function buildTrack(score, name, midiFile, tuning, palmMute, minPitch = 0) {
  const notes = readNoteOns(join(HERE, midiFile)).filter((n) => n.pitch >= minPitch)
  console.log(`  ${midiFile}: ${notes.length} playable notes`)
  if (notes.length === 0) return null

  const track = new model.Track()
  track.name = name
  score.addTrack(track)

  const staff = new model.Staff()
  track.addStaff(staff)
  staff.stringTuning = new model.Tuning('Standard', tuning, true)

  const grid = new Map()
  for (const note of notes) {
    const bar = Math.floor(note.start / (PPQ * 4))
    const slot = Math.floor((note.start % (PPQ * 4)) / SIXTEENTH)
    const key = `${bar}:${slot}`
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key).push(note)
  }

  for (let bar = 0; bar < score.masterBars.length; bar++) {
    const barModel = new model.Bar()
    staff.addBar(barModel)
    const voice = new model.Voice()
    barModel.addVoice(voice)

    for (let slot = 0; slot < 16; slot++) {
      const beat = new model.Beat()
      beat.duration = model.Duration.Sixteenth
      voice.addBeat(beat)

      const used = new Set()
      for (const note of grid.get(`${bar}:${slot}`) ?? []) {
        const placed = placements(note.pitch, tuning).find((p) => !used.has(p.string))
        if (placed === undefined) continue
        used.add(placed.string)
        const n = new model.Note()
        n.string = placed.string
        n.fret = placed.fret
        n.velocity = note.velocity
        beat.addNote(n)
      }
      if (palmMute && beat.notes.length > 0) beat.isPalmMute = true
    }
  }
  return track
}

const timeline = JSON.parse(readFileSync(join(HERE, 'timeline.json'), 'utf8'))
const barCount = timeline.bars

const score = new model.Score()
score.title = 'House 124'
score.artist = 'dsh'
for (let i = 0; i < barCount; i++) {
  const mb = new model.MasterBar()
  mb.timeSignatureNumerator = 4
  mb.timeSignatureDenominator = 4
  mb.tempo = timeline.bpm
  score.addMasterBar(mb)
}

buildTrack(score, 'Power Chords', 'house-power.mid', GUITAR, true, 30)
buildTrack(score, 'Muted Gtr', 'house-gtr.mid', GUITAR, true, 30)
buildTrack(score, 'Jazz Gtr', 'house-jazz.mid', GUITAR, false, 30)
buildTrack(score, 'Lead', 'house-lead.mid', GUITAR, false, 30)
buildTrack(score, 'Bass', 'house-bass.mid', BASS, false, 20)

score.finish(new Settings())

const bytes = new exporter.Gp7Exporter().export(score, new Settings())
const out = join(HERE, 'house-124-fmin.gp')
writeFileSync(out, Buffer.from(bytes))
console.log(`wrote ${out}`)
console.log(`tracks=${score.tracks.map((t) => t.name).join(',')} bars=${barCount} tempo=${timeline.bpm} bytes=${bytes.length}`)
