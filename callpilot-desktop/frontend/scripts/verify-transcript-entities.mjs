// Verification for transcriptEntities.ts - product entity occurrence mapping
// used by the transcript highlighting + rail linkage.
import {
  buildTranscriptEntityMap,
  splitTextByOccurrences,
} from '../src/lib/transcriptEntities.ts';

let failures = 0;
function check(label, cond, extra = '') {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label} ${extra}`); }
}

const clean = (t) => t.replace(/\b(uh|um|er|ah)\b/gi, ' ').replace(/\s+/g, ' ').trim();
const displayOf = (seg) => clean(seg.text);

const segments = [
  { id: 's1', text: "That's exactly why I wanted to show you Prodigy. It's a three phase CT meter.", timestamp: 38 },
  { id: 's2', text: 'Prodigy handles both, but for bulk transfer you want Apex 100 instead.', timestamp: 64 },
  { id: 's3', text: 'the Sprint 210 is three phase with pluggable GPRS modules.', timestamp: 76 },
  { id: 's4', text: 'uh we also mentioned prodigy earlier for the trials and apexpredator is unrelated.', timestamp: 90 },
  { id: 's5', text: 'Prodigy. Apex 100. Prodigy again.', timestamp: 100 },
];

console.log('occurrence mapping:');
const map = buildTranscriptEntityMap(segments, ['Prodigy', 'Apex 100', 'Sprint 210'], displayOf);

const prodigyOcc = map.byEntityName.get('Prodigy') ?? [];
check('Prodigy: 5 occurrences across s1, s2, s4, s5×2', prodigyOcc.length === 5, JSON.stringify(prodigyOcc.map((o) => `${o.segmentId}:${o.startOffset}`)));
check('Apex 100: 2 occurrences (multi-word entity)', (map.byEntityName.get('Apex 100') ?? []).length === 2);
check('Sprint 210: 1 occurrence', (map.byEntityName.get('Sprint 210') ?? []).length === 1);
check('apexpredator NOT matched (word boundary)', !(map.byEntityName.get('Apex 100') ?? []).some((o) => o.segmentId === 's4'));
check('case-insensitive match (prodigy in s4)', prodigyOcc.some((o) => o.segmentId === 's4'));
check('latest Prodigy occurrence = s5 (timestamp)', map.latestByEntityName.get('Prodigy')?.segmentId === 's5');
check('latest Apex 100 = s5', map.latestByEntityName.get('Apex 100')?.segmentId === 's5');
check('s5 carries 3 occurrences (Prodigy, Apex 100, Prodigy)', (map.bySegmentId.get('s5') ?? []).length === 3);

console.log('render splitting:');
const parts = splitTextByOccurrences(clean(segments[4].text), map.bySegmentId.get('s5'));
check('s5 → 6 parts (3 highlights + 3 text chunks)', parts.length === 6, JSON.stringify(parts.map((p) => (p.occurrence ? `[${p.text}]` : p.text))));
check('split reconstructs the display text', parts.map((p) => p.text).join('') === clean(segments[4].text));
check('offsets align with cleaned display (s4 filler removed)', splitTextByOccurrences(clean(segments[3].text), map.bySegmentId.get('s4')).map((p) => p.text).join('') === clean(segments[3].text));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
