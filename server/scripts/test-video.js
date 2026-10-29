// Compares three ways to referee a Freeze Dance clip.
// Usage: node --env-file=../.env scripts/test-video.js <clip.mp4> <framesDir> <freezeAtSeconds> <buzzerAtSeconds> [A|B|C]
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sparkJSON, segmentVideo, segment, toDataUrl } from '../src/meta.js';

const [clip, framesDir, freezeAt, buzzerAt, only] = process.argv.slice(2);
const FREEZE = Number(freezeAt), BUZZER = Number(buzzerAt);
const run = name => !only || only === name;

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['held_still', 'first_movement_seconds', 'reason'],
  properties: {
    held_still: { type: 'boolean' },
    first_movement_seconds: { type: 'number', description: 'Seconds from the start of the clip when the player first moved during the freeze. -1 if they held still.' },
    reason: { type: 'string', description: 'One sentence a host reads out loud.' },
  },
};
const ASK = `Freeze Dance referee. The music stopped at ${FREEZE}s and the player had to hold perfectly still until the buzzer at ${BUZZER}s. Ignore movement before ${FREEZE}s. Did they hold still? Small breathing is fine; arm, leg, head or body movement is not.`;

// A: Muse Spark watches the whole video.
if (run('A')) {
  const t = Date.now();
  try {
    const video = toDataUrl(await readFile(clip), 'video/mp4');
    const { result } = await sparkJSON({ system: 'You are a strict but fair party-game referee.', prompt: ASK, videos: [video], schemaName: 'freeze_verdict', schema: VERDICT, effort: 'medium' });
    console.log(`\nA) Muse Spark on video (${Date.now() - t} ms):`, result);
  } catch (err) { console.log(`\nA) Muse Spark on video FAILED (${Date.now() - t} ms): ${err.message}`); }
}

// B: SAM 3.1 tracks the person through the video; code measures how much the outline changes.
if (run('B')) {
  const t = Date.now();
  try {
    const video = toDataUrl(await readFile(clip), 'video/mp4');
    const { frames } = await segmentVideo(video, 'person');
    const fps = frames.length / 10.06;
    const series = frames.map(f => ({ s: f.frame / fps, b: f.boxes.sort((a, b) => (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1))[0] })).filter(f => f.b);
    // Movement = how far the box edges shift between samples, as % of the frame width.
    const step = Math.max(1, Math.round(fps / 2)); // compare every ~0.5 s
    const moves = [];
    for (let i = step; i < series.length; i += step) {
      const a = series[i - step].b, b = series[i].b;
      const shift = (Math.abs(a.x1 - b.x1) + Math.abs(a.x2 - b.x2) + Math.abs(a.y1 - b.y1) + Math.abs(a.y2 - b.y2)) / b.w * 100;
      moves.push({ s: series[i].s.toFixed(1), shift: shift.toFixed(1) });
    }
    console.log(`\nB) SAM 3.1 video tracking (${Date.now() - t} ms): ${frames.length} frames returned (~${fps.toFixed(1)} fps)`);
    console.log('   Box shift every ~0.5 s (% of width):', moves.map(m => `${m.s}s:${m.shift}`).join('  '));
  } catch (err) { console.log(`\nB) SAM video FAILED (${Date.now() - t} ms): ${err.message}`); }
}

// C: frames (2 per second) from the freeze window go to Muse Spark as images.
if (run('C')) {
  const t = Date.now();
  const files = (await readdir(framesDir)).filter(f => f.endsWith('.jpg')).sort();
  const timeOf = f => Number(f.match(/_(\d+\.\d)s/)[1]);
  const window = files.filter(f => timeOf(f) >= FREEZE && timeOf(f) <= BUZZER);
  const images = await Promise.all(window.map(async f => toDataUrl(await readFile(join(framesDir, f)))));
  const { result } = await sparkJSON({
    system: 'You are a strict but fair party-game referee.',
    prompt: `${ASK}\nThese frames are in order, 0.5 s apart, at times: ${window.map(timeOf).join('s, ')}s.`,
    images, schemaName: 'freeze_verdict', schema: VERDICT, effort: 'medium',
  });
  console.log(`\nC) Frames → Muse Spark (${Date.now() - t} ms, ${window.length} frames):`, result);
}
