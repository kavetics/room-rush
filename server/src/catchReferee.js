// Clap Catch referee. A turn is a sequence of phases: ready (ball in hands) → throw → in the air →
// caught or dropped. SAM 3.1 outlines the player and the object once. Muse Spark labels what the ball is
// doing in every frame. Plain code reads those labels, finds the phases, and counts the claps between
// the throw and the catch. A VAR review also runs SAM on every frame, as extra evidence for Muse Spark.
import { segment, sparkJSON } from './meta.js';
import { countClaps, findSpikes } from './claps.js';

const BALL_CONFIDENCE = 0.3; // a small moving ball scores low; code filters the path below
const MAX_SAM_AT_ONCE = 16;
const ABOVE_HEAD = 0.05; // ball height relative to the player: 0 = top of head, 1 = feet
const NEAR_FLOOR = 0.85;
const HIGH_ON_PLAYER = 0.35; // ball this high on the player, then gone: it probably left the top of the frame
const OUT_OF_FRAME_SECONDS = 0.75;

const BALL_STATES = ['in_hands', 'in_air', 'out_of_frame', 'on_floor', 'not_visible'];

const IDENTIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['player', 'object', 'object_sam_prompt'],
  properties: {
    player: { type: 'string', description: 'Where the person about to throw is, and their clothing. Never their identity, age or appearance otherwise.' },
    object: { type: 'string', description: 'What they are holding to throw, e.g. "small blue ball".' },
    object_sam_prompt: { type: 'string', description: 'Simple generic noun for it, e.g. "ball".' },
  },
};

const TIMELINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['frames', 'reason', 'confidence'],
  properties: {
    frames: {
      type: 'array',
      description: 'One entry per frame, in order.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['t', 'ball'],
        properties: { t: { type: 'number' }, ball: { type: 'string', enum: BALL_STATES } },
      },
    },
    reason: { type: 'string', description: 'One short, friendly sentence spoken to the player as "you", saying what happened. Never use he, she or other descriptions of the person.' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const SYSTEM = [
  'You referee a party game. One player, standing or seated, throws a small object or balloon up, claps, and tries to catch it. Label what the object is doing in each frame.',
  'in_hands: held by the player, or trapped against their body or lap by their hands. in_air: visibly in the air.',
  'out_of_frame: it left the frame, usually out the top on a high throw. High throws are the best throws, and leaving the frame never counts against the player.',
  'on_floor: on or just above the floor, or rolling away. A low catch close to the floor is still in_hands.',
  'not_visible: in frame but you cannot tell where it is. The object is small and fast, and is often blurred or hidden by hands.',
  'Other people may be in the frame: only follow the player. Use the sequence: if it was thrown and later is in their hands without touching the floor, label those frames that way.',
].join(' ');

/** Plain-code rules that turn the frame labels into phases. Only the first throw counts. */
export function findPhases(labels) {
  const inFlight = l => l.ball === 'in_air' || l.ball === 'out_of_frame';
  const first = labels.findIndex(inFlight);
  if (first < 0) return { call: labels.some(l => l.ball === 'on_floor') ? 'dropped' : 'unclear', thrownAt: null, endedAt: null, noThrow: true };
  // The throw starts at the last frame in hands; a clip can begin with the ball already up.
  const thrownAt = first > 0 ? labels[first - 1].t : labels[0].t;
  for (let i = first + 1; i < labels.length; i++) {
    if (labels[i].ball === 'on_floor') return { call: 'dropped', thrownAt, endedAt: labels[i].t };
    if (labels[i].ball === 'in_hands') {
      // Hands near the ball for one frame, with it still flying after, isn't a catch yet.
      const stillFlying = i + 1 < labels.length && inFlight(labels[i + 1]);
      if (!stillFlying) return { call: 'caught', thrownAt, endedAt: labels[i].t };
    }
  }
  return { call: 'unclear', thrownAt, endedAt: null };
}

const FALLBACK_REASONS = {
  caught: 'You caught it cleanly!',
  dropped: 'The ball hit the floor before you caught it.',
  unclear: "I couldn't tell where the ball ended up.",
};

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
  const highest = seen.reduce((best, p) => (!best || p.height < best.height ? p : best), null);
  // A high throw leaves the frame: the ball is rising, disappears for a while, then may come back.
  let leftFrameAt = null;
  let cameBackAt = null;
  seen.forEach((p, i) => {
    const next = seen[i + 1];
    const endOfClip = path.at(-1).t;
    const gap = (next?.t ?? endOfClip) - p.t;
    if (leftFrameAt == null && p.height < HIGH_ON_PLAYER && gap >= OUT_OF_FRAME_SECONDS && (i === 0 || seen[i - 1].height >= p.height)) {
      leftFrameAt = p.t;
      cameBackAt = next?.t ?? null;
    }
  });
  const peak = leftFrameAt != null ? seen.find(p => p.t === leftFrameAt) : highest;
  const thrown = Boolean(peak && (peak.height < ABOVE_HEAD || leftFrameAt != null));
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
    leftFrameAt,
    cameBackAt,
    endHeight: end?.height ?? null,
    endedNearFloor: end ? end.height >= NEAR_FLOOR : null,
    wasNearFloor: seen.some(p => p.height >= NEAR_FLOOR),
  };
}

/** frames: [{ t, dataUrl }] in time order. review: a VAR request, which also tracks with SAM on every frame. */
export async function refereeCatch(frames, { envelope, onProgress = () => {}, review = false } = {}) {
  const started = Date.now();
  let sparkMs = 0;
  let samMs = 0;
  let samCalls = 0;
  let lookFailures = 0;
  let lastLookError = null;
  // One failed look is survivable. But if the API is refusing calls (billing, outage), say so:
  // "I couldn't see the ball" would blame the player for our problem.
  const look = async (f, prompt, minConfidence) => {
    const begun = Date.now();
    samCalls += 1;
    try {
      return (await segment(f.dataUrl, prompt, { minConfidence })).objects;
    } catch (err) {
      lookFailures += 1;
      lastLookError = err.message;
      return [];
    } finally {
      samMs = Math.max(samMs, Date.now() - begun);
    }
  };
  const biggest = list => list.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0]?.box ?? null;

  // 1. Who is playing, and with what? The object can be any color, size or shape.
  let identified = { player: null, object: 'ball', object_sam_prompt: 'ball' };
  try {
    const { result, ms } = await sparkJSON({
      system: 'You help referee a party game: a player, standing or seated, is about to throw a small object or balloon up and catch it.',
      prompt: 'Who is about to throw, and what are they holding?',
      images: [frames[0].dataUrl, frames[Math.min(2, frames.length - 1)].dataUrl],
      schemaName: 'who_and_what',
      schema: IDENTIFY_SCHEMA,
    });
    identified = result;
    sparkMs += ms;
  } catch (err) {
    // Not needed to judge the turn, unless the API is down; then the next call reports it.
  }
  const [objectAtStart, peopleAtStart] = await Promise.all([
    look(frames[0], identified.object_sam_prompt, BALL_CONFIDENCE),
    look(frames[0], 'person', 0.5),
  ]);
  if (lookFailures === samCalls && lastLookError) throw new Error(`The AI service refused the referee's request: ${lastLookError}`);
  const start = { object: biggest(objectAtStart), player: biggest(peopleAtStart) };
  onProgress({ step: 'identified', player: identified.player, object: identified.object });
  onProgress({ step: 'frame', index: 0, t: frames[0].t, total: 1, ball: start.object });

  // 2. VAR only: SAM follows the object through every frame, as evidence and for the replay.
  let measured = null;
  if (review) {
    const [balls, people] = await Promise.all([
      inPool(frames, (f, index) => look(f, identified.object_sam_prompt, BALL_CONFIDENCE).then(found => {
        onProgress({ step: 'frame', index, t: f.t, total: frames.length, ball: found[0]?.box ?? null });
        return found;
      })),
      inPool(frames.filter((_, i) => i % 2 === 0), f => look(f, 'person', 0.5)),
    ]);
    if (lookFailures > samCalls / 2) throw new Error(`The AI service refused the referee's request: ${lastLookError}`);
    const personAt = frames.map((_, i) => {
      const near = [i - i % 2, i - i % 2 + 2, i - i % 2 - 2].map(n => people[n / 2]).find(p => p?.length);
      return near ? biggest(near) : null;
    });
    measured = measureBall(frames.map((f, i) => ({ t: f.t, balls: balls[i].map(o => o.box), person: personAt[i] })));
  }

  // 3. Muse Spark says what the object is doing in each frame.
  onProgress({ step: 'spark', frames: frames.length, times: frames.map(f => f.t) });
  const { result: timeline, ms } = await sparkJSON({
    system: SYSTEM,
    prompt: [
      `The player: ${identified.player ?? 'the person who throws'}. The object: ${identified.object}.`,
      `There are ${frames.length} frames in time order, at ${frames.map(f => `${f.t}s`).join(', ')}.`,
      measured && `A tracker measured the object's height on the player (0 = top of head, 1 = feet; it often loses the object, so trust what you see): ${measured.path.filter(p => p.height != null).map(p => `${p.t}s:${p.height}`).join(' ') || 'nothing found'}.`,
      'Label each frame, then say in one sentence what happened.',
    ].filter(Boolean).join('\n'),
    images: frames.map(f => f.dataUrl),
    schemaName: 'ball_timeline',
    schema: TIMELINE_SCHEMA,
    effort: review ? 'high' : (process.env.CATCH_EFFORT || 'medium'),
  });
  sparkMs += ms;

  // 4. Plain code: labels → phases → claps between the throw and the catch.
  const labels = frames.map((f, i) => ({ t: f.t, ball: timeline.frames[i]?.ball ?? 'not_visible' }));
  const phases = findPhases(labels);
  onProgress({ step: 'measured', thrownAt: phases.thrownAt, peakAt: null, framesWithBall: labels.filter(l => l.ball !== 'not_visible').length, total: frames.length });
  onProgress({ step: 'call', call: phases.call, reason: timeline.reason });
  const heard = envelope ? findSpikes(envelope) : [];
  const caughtAt = phases.call === 'caught' ? phases.endedAt : null;
  const claps = envelope && phases.thrownAt != null ? countClaps(envelope, { thrownAt: phases.thrownAt, caughtAt: phases.endedAt }) : null;

  const report = {
    track: measured ? measured.path.map(({ t, ball, person, height }) => ({ t, ball, person, height })) : [{ t: frames[0].t, ball: start.object, person: start.player }],
    thrownAt: phases.thrownAt,
    peakAt: null,
    sparkTimes: frames.map(f => f.t),
    labels,
  };
  const spoken = /(drop|miss|floor|slip)/i.test(timeline.reason) === (phases.call === 'dropped') && phases.call !== 'unclear';
  return {
    call: phases.call,
    reason: spoken ? timeline.reason : FALLBACK_REASONS[phases.call],
    confidence: timeline.confidence,
    caughtAt,
    score: phases.call === 'caught' ? (claps?.count ?? null) : 0,
    claps: envelope ? { count: claps?.count ?? null, heard: heard.map(s => s.t), counted: claps?.counted.map(s => s.t) ?? [] } : null,
    closeCall: false,
    review,
    identified,
    evidence: {
      thrown: phases.thrownAt != null,
      thrownAt: phases.thrownAt,
      endedAt: phases.endedAt,
      framesWithBall: `${labels.filter(l => l.ball !== 'not_visible').length} of ${frames.length}`,
      labels: labels.map(l => `${l.t}:${l.ball}`).join(' '),
    },
    report,
    timing: { samCalls, samMs, sparkMs, framesSentToSpark: frames.length, totalMs: Date.now() - started },
  };
}
