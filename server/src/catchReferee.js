// Clap Catch referee: did the player catch the ball? There's no "hold the pose" rule, so the catch
// can happen anywhere in the clip. SAM 3.1 follows the ball on every frame, plain code finds the
// throw and where the ball ended up, and Muse Spark rules from the frames around the landing.
import { segment, sparkJSON } from './meta.js';
import { countClaps, findSpikes } from './claps.js';

const BALL_CONFIDENCE = 0.3; // a small moving ball scores low; code filters the path below
const MAX_SAM_AT_ONCE = 16;
const ABOVE_HEAD = 0.05; // ball height relative to the player: 0 = top of head, 1 = feet
const NEAR_FLOOR = 0.85;
const AFTER_PEAK_SECONDS = 2;
const MAX_SPARK_FRAMES = 12;

const CATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['call', 'caught_at_seconds', 'reason', 'confidence'],
  properties: {
    call: { type: 'string', enum: ['caught', 'dropped', 'unclear'] },
    caught_at_seconds: { type: 'number', description: 'Time of the catch. Use -1 if it was not caught.' },
    reason: { type: 'string', description: 'One short, friendly sentence spoken to the player as "you". Never use he, she or other descriptions of the person.' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const SYSTEM = [
  'You referee a party game. A player throws a small yellow ball up and tries to catch it.',
  'caught: the ball came down into the hands, or was trapped against the body, without touching the floor first.',
  'dropped: the ball touched the floor or was missed. Picking it up afterwards is still dropped.',
  'Other people may be in the frame: judge only the person who throws the ball.',
  'unclear: the frames do not show enough to decide. Never guess.',
].join(' ');

async function inPool(items, work) {
  const results = new Array(items.length);
  let next = 0;
  const runner = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await work(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_SAM_AT_ONCE, items.length) }, runner));
  return results;
}

const center = b => ({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 });

/** Plain-code math: the ball's path relative to the player, the throw's peak, and where the ball ended. */
export function measureBall(track) {
  let lastBall = null;
  const path = track.map(f => {
    // Several "balls" in a frame: take the one closest to where the ball just was.
    const ball = f.balls.slice().sort((a, b) => lastBall
      ? Math.hypot(center(a).x - lastBall.x, center(a).y - lastBall.y) - Math.hypot(center(b).x - lastBall.x, center(b).y - lastBall.y)
      : 0)[0] ?? null;
    if (ball) lastBall = center(ball);
    const person = f.person;
    const height = ball && person ? (center(ball).y - person.y1) / Math.max(1, person.y2 - person.y1) : null;
    return { t: f.t, ball, person, height: height == null ? null : Math.round(height * 100) / 100 };
  });

  const seen = path.filter(p => p.height != null);
  const peak = seen.reduce((best, p) => (!best || p.height < best.height ? p : best), null);
  const thrown = Boolean(peak && peak.height < ABOVE_HEAD);
  const end = seen.at(-1) ?? null;
  // The throw starts where the ball last stopped rising on its way to the peak.
  let thrownAt = null;
  if (thrown) {
    const up = seen.slice(0, seen.indexOf(peak) + 1);
    let i = up.length - 1;
    while (i > 0 && up[i - 1].height > up[i].height) i--;
    thrownAt = up[i].t;
  }
  return {
    path,
    framesWithBall: path.filter(p => p.ball).length,
    framesWithPerson: path.filter(p => p.person).length,
    thrown,
    peakAt: thrown ? peak.t : null,
    thrownAt,
    endHeight: end?.height ?? null,
    endedNearFloor: end ? end.height >= NEAR_FLOOR : null,
  };
}

// Dense frames right after the peak (where the catch happens), then a few to the end of the clip.
function pickFrames(frames, peakAt) {
  const start = peakAt == null ? 0 : frames.findIndex(f => f.t >= peakAt);
  const after = frames.slice(Math.max(0, start));
  const near = after.filter(f => f.t <= after[0].t + AFTER_PEAK_SECONDS);
  const rest = after.slice(near.length);
  const room = Math.max(0, MAX_SPARK_FRAMES - near.length);
  const later = rest.filter((_, i) => rest.length <= room || (i % Math.ceil(rest.length / Math.max(1, room))) === 0).slice(0, room);
  if (rest.length && !later.includes(rest.at(-1))) later[Math.max(0, later.length - 1)] = rest.at(-1);
  return [...near, ...later].slice(0, MAX_SPARK_FRAMES);
}

/** frames: [{ t, dataUrl }] in time order. */
export async function refereeCatch(frames, { envelope, onProgress = () => {} } = {}) {
  const started = Date.now();
  const look = (f, prompt, minConfidence) => segment(f.dataUrl, prompt, { minConfidence })
    .then(r => r.objects).catch(() => []);

  // The ball on every frame; the player moves less, so every other frame is enough.
  const samStart = Date.now();
  const [balls, people] = await Promise.all([
    inPool(frames, (f, index) => look(f, 'ball', BALL_CONFIDENCE).then(found => {
      onProgress({ step: 'frame', index, t: f.t, total: frames.length, ball: found[0]?.box ?? null });
      return found;
    })),
    inPool(frames.filter((_, i) => i % 2 === 0), f => look(f, 'person', 0.5)),
  ]);
  const samMs = Date.now() - samStart;
  const samCalls = balls.length + people.length;

  const biggest = list => list.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0]?.box ?? null;
  const personAt = frames.map((_, i) => {
    const near = [i - i % 2, i - i % 2 + 2, i - i % 2 - 2].map(n => people[n / 2]).find(p => p?.length);
    return near ? biggest(near) : null;
  });
  const track = frames.map((f, i) => ({ t: f.t, balls: balls[i].map(o => o.box), person: personAt[i] }));
  const measured = measureBall(track);
  const evidence = {
    thrown: measured.thrown,
    thrownAt: measured.thrownAt,
    peakAt: measured.peakAt,
    framesWithBall: `${measured.framesWithBall} of ${frames.length}`,
    endHeight: measured.endHeight,
    endedNearFloor: measured.endedNearFloor,
    // Height of the ball on the player: 0 = top of head, 1 = feet, below 0 = above the head.
    path: measured.path.filter(p => p.height != null).map(p => `${p.t}s:${p.height}`).join(' '),
  };

  onProgress({ step: 'measured', thrownAt: measured.thrownAt, peakAt: measured.peakAt, framesWithBall: measured.framesWithBall, total: frames.length });

  const timing = { samMs, samCalls, sparkMs: 0, totalMs: 0, framesSentToSpark: 0 };
  // Everything the report needs to replay what the AI saw, in step with the video.
  const report = {
    track: measured.path.map(({ t, ball, person, height }) => ({ t, ball, person, height })),
    thrownAt: measured.thrownAt,
    peakAt: measured.peakAt,
    sparkTimes: [],
  };
  // Even when the turn can't be judged, show what was heard.
  const heardOnly = envelope ? { count: null, heard: findSpikes(envelope).map(s => s.t), counted: [] } : null;
  const finish = fields => ({ claps: heardOnly, ...fields, evidence, report, timing: { ...timing, totalMs: Date.now() - started } });

  // Nothing to judge: don't spend a Spark call, and don't guess.
  if (measured.framesWithBall === 0) return finish({ call: 'unclear', reason: "I couldn't see the ball. Make sure it's in the shot and try again.", confidence: 1, caughtAt: null, closeCall: false });
  if (!measured.framesWithPerson) return finish({ call: 'unclear', reason: "I couldn't see the player. Step back so your whole body is in the shot.", confidence: 1, caughtAt: null, closeCall: false });

  const chosen = pickFrames(frames, measured.peakAt);
  timing.framesSentToSpark = chosen.length;
  report.sparkTimes = chosen.map(f => f.t);
  onProgress({ step: 'spark', frames: chosen.length, times: report.sparkTimes });
  const { result, ms } = await sparkJSON({
    system: SYSTEM,
    prompt: [
      `These ${chosen.length} frames are in time order, at ${chosen.map(f => `${f.t}s`).join(', ')}.`,
      `Measured from every frame of the clip: ${JSON.stringify(evidence)}. The ball may be missing or wrong in some frames, so trust what you see.`,
      'Did the player catch the ball?',
    ].join('\n'),
    images: chosen.map(f => f.dataUrl),
    schemaName: 'catch_call',
    schema: CATCH_SCHEMA,
    effort: 'medium',
  });
  timing.sparkMs = ms;

  // Plain code counts the claps, between the throw and the catch. A drop scores 0 whatever was clapped.
  const caughtAt = result.call === 'caught' && result.caught_at_seconds >= 0 ? result.caught_at_seconds : null;
  onProgress({ step: 'call', call: result.call, reason: result.reason });
  const claps = envelope ? countClaps(envelope, { thrownAt: measured.thrownAt, caughtAt }) : null;

  return finish({
    claps: claps && { count: claps.count, heard: claps.spikes.map(s => s.t), counted: claps.counted.map(s => s.t) },
    score: result.call === 'caught' ? (claps?.count ?? null) : 0,
    call: result.call,
    reason: result.reason,
    confidence: result.confidence,
    caughtAt,
    // The ball ending on the floor after a "catch" is suspicious; worth flagging, not overruling.
    closeCall: result.call === 'caught' && measured.endedNearFloor === true,
  });
}
