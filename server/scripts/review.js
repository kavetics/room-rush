// Review a recorded game: where it stalled, what failed, and which calls look suspicious.
//   npm run review                   newest session with turns
//   npm run review -- <session-id>
//   npm run review -- --rerun        also run the saved turns through the current referee
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toDataUrl } from '../src/meta.js';
import { refereeCatch } from '../src/catchReferee.js';

const ROOT = new URL('../../test-photos/sessions/', import.meta.url).pathname;
const STALL_SECONDS = 4;
const args = process.argv.slice(2);
const rerun = args.includes('--rerun');
const list = async dir => readdir(dir).catch(() => []);
const json = (path, fallback = null) => readFile(path, 'utf8').then(JSON.parse).catch(() => fallback);

let id = args.find(a => !a.startsWith('--'));
if (!id) {
  const sessions = (await list(ROOT)).sort().reverse();
  for (const s of sessions) if ((await list(join(ROOT, s, 'turns'))).length) { id = s; break; }
}
if (!id) throw new Error('No recorded games yet.');
const dir = join(ROOT, id);
console.log(`Session ${id}\n`);

const events = (await readFile(join(dir, 'timeline.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(l => JSON.parse(l));
const label = e => (e.type === 'phone' ? e.message : `${e.type} ${Object.entries(e).filter(([k]) => !['at', 's', 'type'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' ')}`).slice(0, 110);

console.log('Timeline (gaps of 4 s or more are marked)');
let last = null;
for (const e of events) {
  const gap = last == null ? 0 : e.s - last;
  console.log(`${gap >= STALL_SECONDS ? `⏳ +${gap.toFixed(1)}s` : '        '} ${e.s.toFixed(1).padStart(7)}s  ${label(e)}`);
  last = e.s;
}

const problem = /fail|refused|unavailable|blocked|error|rejected/i;
const problems = events.filter(e => problem.test(label(e)));
console.log(`\nProblems: ${problems.length}`);
problems.forEach(e => console.log(`  ${e.s.toFixed(1)}s  ${label(e)}`));

const turns = (await list(join(dir, 'turns'))).sort();
console.log(`\nTurns: ${turns.length}`);
for (const turn of turns) {
  const path = join(dir, 'turns', turn);
  const meta = await json(join(path, 'meta.json'), {});
  const c = meta.call;
  const flags = [];
  if (meta.failure) flags.push(`failed: ${meta.failure}`);
  if (c?.call === 'unclear') flags.push("couldn't tell");
  if (c && c.claps == null) flags.push('no sound');
  if (c?.call === 'caught' && c.claps?.count == null) flags.push('no clap count');
  if (c?.evidence && !c.evidence.thrown) flags.push('no throw found');
  if (c?.closeCall) flags.push('close call');
  if (c?.timing?.totalMs > 20000) flags.push('slow');
  console.log(`${flags.length ? '⚠️ ' : '✅'} ${turn} ${meta.name ?? ''}: ${c?.call ?? 'no result'} · claps ${c?.claps?.count ?? '?'} · ball in ${c?.evidence?.framesWithBall ?? '?'} · ${c ? (c.timing.totalMs / 1000).toFixed(1) : '?'}s${flags.length ? ` · ${flags.join(', ')}` : ''}`);
  if (c?.reason) console.log(`     "${c.reason}"`);
  if (rerun) {
    const files = (await list(path)).filter(f => f.endsWith('.jpg')).sort();
    const frames = await Promise.all(files.map(async (f, i) => ({ t: meta.times[i], dataUrl: toDataUrl(await readFile(join(path, f))) })));
    const envelope = await json(join(path, 'envelope.json'), undefined);
    const again = await refereeCatch(frames, { envelope });
    const same = again.call === c?.call && again.claps?.count === c?.claps?.count;
    console.log(`     rerun ${same ? 'same' : 'CHANGED'}: ${again.call} · claps ${again.claps?.count ?? '?'} · ${(again.timing.totalMs / 1000).toFixed(1)}s · "${again.reason}"`);
  }
}
