// Accuracy test for the catch referee. Runs every saved trial from the voice-guided test mode:
//   npm run test:catch              (newest run in test-photos/catch-runs)
//   npm run test:catch -- <run-id>
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toDataUrl } from '../src/meta.js';
import { refereeCatch } from '../src/catchReferee.js';

const ROOT = new URL('../../test-photos/catch-runs/', import.meta.url).pathname;
const runs = (await readdir(ROOT)).filter(n => !n.startsWith('.')).sort();
const run = process.argv[2] || runs.at(-1);
if (!run) throw new Error('No saved runs yet. Use the test mode in the app first.');
const dir = join(ROOT, run);
const trials = (await readdir(dir)).filter(n => n.startsWith('trial-')).sort();

const results = [];
for (const name of trials) {
  const meta = JSON.parse(await readFile(join(dir, name, 'label.json'), 'utf8'));
  const frames = await Promise.all(meta.times.map(async (t, i) => ({
    t, dataUrl: toDataUrl(await readFile(join(dir, name, `f${String(i).padStart(3, '0')}.jpg`))),
  })));
  const envelope = await readFile(join(dir, name, 'envelope.json'), 'utf8').then(JSON.parse).catch(() => undefined);
  const r = await refereeCatch(frames, { envelope });
  const right = r.call === meta.label;
  const clapsRight = meta.claps == null || meta.label !== 'caught' ? null : r.claps?.count === meta.claps;
  results.push({ trial: name, label: meta.label, style: meta.style, call: r.call, right, expectedClaps: meta.claps, claps: r.claps, clapsRight, reason: r.reason, confidence: r.confidence, timing: r.timing, evidence: r.evidence });
  console.log(`${right ? '✅' : r.call === 'unclear' ? '🤔' : '❌'} ${name} ${meta.label}${meta.style ? ` (${meta.style})` : ''} → ${r.call} · ${(r.timing.totalMs / 1000).toFixed(1)}s · ball in ${r.evidence.framesWithBall} ${meta.claps != null ? `· claps ${r.claps?.count ?? '?'} (expected ${meta.claps}, heard at ${r.claps?.heard.join(', ') || 'none'}) ` : ''}· ${r.reason}`);
}

const count = fn => results.filter(fn).length;
const n = results.length || 1;
const judged = results.filter(r => r.call !== 'unclear');
const avg = fn => results.reduce((sum, r) => sum + fn(r), 0) / n;
const clapTrials = results.filter(r => r.clapsRight != null);
const summary = {
  run,
  trials: results.length,
  accuracy: count(r => r.right) / n,
  accuracyWhenDecided: judged.length ? judged.filter(r => r.right).length / judged.length : null,
  unclear: count(r => r.call === 'unclear'),
  caughtCalledDropped: count(r => r.label === 'caught' && r.call === 'dropped'),
  droppedCalledCaught: count(r => r.label === 'dropped' && r.call === 'caught'),
  clapTurns: clapTrials.length,
  clapsExact: clapTrials.filter(r => r.clapsRight).length,
  clapsOffByOne: clapTrials.filter(r => r.claps?.count != null && Math.abs(r.claps.count - r.expectedClaps) === 1).length,
  avgSeconds: avg(r => r.timing.totalMs) / 1000,
  avgSamCalls: avg(r => r.timing.samCalls),
  avgSparkFrames: avg(r => r.timing.framesSentToSpark),
};
console.log('\n', summary);
await writeFile(join(dir, 'results.json'), JSON.stringify({ summary, results }, null, 2));
