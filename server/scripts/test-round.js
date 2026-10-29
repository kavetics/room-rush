// Referee a recorded round from a folder of frames named like f12_6.0s.jpg.
// Usage: node --env-file=../.env scripts/test-round.js <framesDir> [gameId] [roundIndex] [upToSeconds]
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { toDataUrl } from '../src/meta.js';
import { CLASSICS } from '../src/classics.js';
import { refereeRound } from '../src/roundReferee.js';

const [dir, gameId = 'freeze_dance', roundIndex = '0', upTo = '999'] = process.argv.slice(2);
const files = (await readdir(dir)).filter(f => /_\d+\.\ds\.jpg$/.test(f)).sort();
const frames = (await Promise.all(files.map(async f => ({ t: Number(f.match(/_(\d+\.\d)s/)[1]), dataUrl: toDataUrl(await readFile(join(dir, f))) }))))
  .filter(f => f.t <= Number(upTo));

const round = CLASSICS.find(g => g.id === gameId).rounds[Number(roundIndex)];
const r = await refereeRound(round, frames);
console.log(`Frames: ${frames.length} (0–${frames.at(-1).t}s) · ${r.totalMs} ms`);
console.log(`Freeze detected at: ${r.freezeAt ?? 'not found'}s`);
for (const p of r.players ?? []) console.log(`  ${p.label}: ${p.moved ? `❌ moved at ${p.first_movement_seconds}s` : '✅ held still'}${p.closeCall ? ' (close call)' : ''}`);
console.log(`Reason: ${r.reason}`);
if (r.meter) console.log('Meter:', r.meter.players.map(p => `${p.label} ` + r.meter.times.map((t, i) => `${t}:${p.shifts[i]}`).join(' ')).join('\n       '));
