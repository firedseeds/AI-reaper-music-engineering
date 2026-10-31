"""Write the house synth parts as MusicXML keyboard staves.

GP5 has no keyboard staff — every track is a 6-string tablature. GP8 can import
MusicXML, which does support piano parts, so the three synthesizer tracks
(Stabs, Clav, Lead) are exported here as standard notation instead.

Usage:  python make-musicxml.py
Output: house-124-keys.musicxml   (import in GP8: File -> Import -> MusicXML)
"""

import json
import struct
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).parent
PPQ = 480
SIXTEENTH = PPQ // 4
DIVISIONS = 4  # per quarter note -> a sixteenth is 1 division

STEPS = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"]
ALTER = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]


def read_midi(path):
    data = path.read_bytes()
    assert data[:4] == b"MThd"
    header_len = struct.unpack(">I", data[4:8])[0]
    ntrks = struct.unpack(">H", data[10:12])[0]
    offset = 8 + header_len
    notes = []

    for _ in range(ntrks):
        length = struct.unpack(">I", data[offset + 4:offset + 8])[0]
        p = offset + 8
        end = p + length
        tick = 0
        status = 0
        open_notes = {}

        def read_vlq():
            nonlocal p
            value = 0
            while True:
                b = data[p]
                p += 1
                value = (value << 7) | (b & 0x7F)
                if not b & 0x80:
                    return value

        while p < end:
            tick += read_vlq()
            b = data[p]
            if b == 0xFF:
                p += 2
                ln = read_vlq()
                p += ln
                continue
            if b & 0x80:
                status = b
                p += 1
            kind = status & 0xF0
            if kind in (0x90, 0x80):
                pitch = data[p]
                vel = data[p + 1]
                p += 2
                if kind == 0x90 and vel > 0:
                    open_notes[pitch] = (tick, vel)
                else:
                    on = open_notes.pop(pitch, None)
                    if on:
                        notes.append((on[0], tick - on[0], pitch, on[1]))
            elif kind in (0xC0, 0xD0):
                p += 1
            else:
                p += 2
        offset = end
    return notes


def pitch_xml(pitch):
    step = STEPS[pitch % 12]
    alter = ALTER[pitch % 12]
    octave = pitch // 12 - 1
    out = f"<step>{step}</step>"
    if alter:
        out += f"<alter>{alter}</alter>"
    out += f"<octave>{octave}</octave>"
    return out


def part_xml(part_id, name, notes, bar_count, sections, bpm):
    last_tick = max((t + d for t, d, _, _ in notes), default=0)
    grid = {}
    for start, dur, pitch, vel in notes:
        bar = start // (PPQ * 4)
        slot = (start % (PPQ * 4)) // SIXTEENTH
        grid.setdefault((bar, slot), []).append((pitch, vel))

    lines = [f'  <part id="{part_id}">']

    for bar in range(bar_count):
        lines.append(f'    <measure number="{bar + 1}">')
        if bar == 0:
            lines.append(
                '      <attributes>'
                f'<divisions>{DIVISIONS}</divisions>'
                '<key><fifths>-4</fifths></key>'
                '<time><beats>4</beats><beat-type>4</beat-type></time>'
                '<clef><sign>G</sign><line>2</line></clef>'
                '</attributes>'
            )
            lines.append(f'      <direction placement="above"><direction-type>'
                         f'<metronome><beat-unit>quarter</beat-unit><per-minute>{bpm}</per-minute></metronome>'
                         f'</direction-type><sound tempo="{bpm}"/></direction>')

        marker = next((s["name"] for s in sections if s["startBar"] == bar), None)
        if marker:
            lines.append(f'      <direction placement="above"><direction-type>'
                         f'<words>{escape(marker)}</words></direction-type></direction>')

        for slot in range(16):
            hits = grid.get((bar, slot), [])
            if not hits:
                lines.append('      <note><rest/><duration>1</duration><voice>1</voice><type>16th</type></note>')
                continue
            for index, (pitch, vel) in enumerate(sorted(hits, key=lambda h: -h[0])):
                chord = '<chord/>' if index else ''
                lines.append(
                    '      <note>' + chord +
                    f'<pitch>{pitch_xml(pitch)}</pitch>'
                    f'<duration>1</duration><voice>1</voice><type>16th</type>'
                    f'<velocity>{vel}</velocity>'
                    '</note>'
                )
        lines.append('    </measure>')

    lines.append('  </part>')
    return "\n".join(lines)


def main():
    timeline = json.loads((HERE / "timeline.json").read_text(encoding="utf-8"))
    bpm = timeline["bpm"]
    sections = timeline["sections"]

    sources = [
        ("P1", "Stabs", "house-stabs.mid"),
        ("P2", "Clav", "house-clav.mid"),
        ("P3", "Lead", "house-lead.mid"),
    ]

    loaded = [(pid, name, read_midi(HERE / midi)) for pid, name, midi in sources]
    longest = max((max(t + d for t, d, _, _ in notes) for _, _, notes in loaded if notes), default=0)
    bar_count = (longest + PPQ * 4 - 1) // (PPQ * 4)

    parts = "\n".join(part_xml(pid, name, notes, bar_count, sections, bpm) for pid, name, notes in loaded)
    part_list = "\n".join(
        f'    <score-part id="{pid}"><part-name>{escape(name)}</part-name></score-part>'
        for pid, name, _ in loaded
    )

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
        '"http://www.musicxml.org/dtds/partwise.dtd">\n'
        '<score-partwise version="4.0">\n'
        '  <work><work-title>House 124 - keys</work-title></work>\n'
        f'  <part-list>\n{part_list}\n  </part-list>\n'
        f'{parts}\n'
        '</score-partwise>\n'
    )

    out = HERE / "house-124-keys.musicxml"
    out.write_text(xml, encoding="utf-8")
    print(f"wrote {out}")
    print(f"parts={[name for _, name, _ in loaded]} bars={bar_count} tempo={bpm}")

    # sanity check: parse it back
    import xml.etree.ElementTree as ET
    tree = ET.parse(out)
    root = tree.getroot()
    counts = {
        part.get("id"): len(part.findall("./measure"))
        for part in root.findall("./part")
    }
    print("parsed ok:", counts)


if __name__ == "__main__":
    main()
