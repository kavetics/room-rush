// Referee for a recorded round. The phone sends frames (~2 per second) pulled from the clip.
//   motion_after_cue: SAM measures each player's movement per frame (the "movement meter"),
//                     code finds when the group froze, Muse Spark makes the call from the frames.
//   everything else:  judged from the last frame with the photo referee.
import { segment, sparkJSON } from './meta.js';
import { referee } from './referee.js';

const STILL_PCT = 6; // outline shift (% of frame width) below this counts as holding still
const MIN_PLAYER_HEIGHT = 0.2; // smaller "people" are photos, posters or far-away bystanders, not players

const center = b => ({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 });
const shiftPct = (a, b, width) =>
  ((Math.abs(a.x1 - b.x1) + Math.abs(a.x2 - b.x2) + Math.abs(a.y1 - b.y1) + Math.abs(a.y2 - b.y2)) / width) * 100;
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

/** Follow each player through the frames. Players are named P1, P2… from left to right in the last frame. */
function trackPlayers(perFrame) {
  const last = perFrame.at(-1);
  const anchors = last.boxes.filter(b => (b.y2 - b.y1) / b.h >= MIN_PLAYER_HEIGHT).sort((a, b) => center(a).x - center(b).x);
  const width = last.boxes[0]?.w || 640;
  const players = anchors.map((anchor, i) => {
    const series = perFrame.map(f => {
      if (!f.boxes.length) return null;
      const c = center(anchor);
      return f.boxes.reduce((best, b) => {
        const d = Math.hypot(center(b).x - c.x, center(b).y - c.y);
        return d < best.d ? { b, d } : best;
      }, { b: null, d: Infinity }).b;
    });
    const shifts = series.map((b, j) => (j === 0 || !b || !series[j - 1]) ? 0 : shiftPct(series[j - 1], b, width));
    return { label: `P${i + 1}`, box: anchor, series, shifts };
  });
  return { players, width };
}

/** The freeze starts when the whole group goes still for at least two steps in a row. */
function findFreeze(times, players) {
  const group = times.map((_, j) => median(players.map(p => p.shifts[j])));
  for (let j = 2; j < times.length - 1; j++) {
    if (group[j] < STILL_PCT && group[j + 1] < STILL_PCT) return j - 1; // last frame before stillness
  }
  return -1;
}

const FREEZE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['players', 'reason'],
  properties: {
    players: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'moved', 'first_movement_seconds'],
        properties: {
          label: { type: 'string', description: 'P1, P2… as given.' },
          moved: { type: 'boolean' },
          first_movement_seconds: { type: 'number', description: '-1 if they held still.' },
        },
      },
    },
    reason: { type: 'string', description: 'One or two upbeat sentences the host reads out loud.' },
  },
};

async function refereeFreeze(round, frames) {
  const samStarted = Date.now();
  let ignored = 0;
  const perFrame = await Promise.all(frames.map(async f => {
    const { objects } = await segment(f.dataUrl, 'person').catch(() => ({ objects: [] }));
    const all = objects.map(o => ({ ...o.box, w: o.imageSize.width, h: o.imageSize.height }));
    const boxes = all.filter(b => (b.y2 - b.y1) / b.h >= MIN_PLAYER_HEIGHT);
    ignored = Math.max(ignored, all.length - boxes.length);
    return { t: f.t, boxes, ignoredBoxes: all.filter(b => !boxes.includes(b)) };
  }));
  const samMs = Date.now() - samStarted;
  if (!perFrame.at(-1).boxes.length) {
    return { verdict: 'unclear', reason: "I couldn't see anyone in the last part of the clip. Try again with everyone in frame!" };
  }

  const times = frames.map(f => f.t);
  const { players } = trackPlayers(perFrame);
  const start = findFreeze(times, players);
  const window = frames.slice(Math.max(start, 0)).slice(-12); // Muse Spark sees up to 12 frames
  const evidence = players.map(p => {
    const after = p.shifts.slice(start + 1);
    const firstMove = after.findIndex(s => s >= STILL_PCT);
    return {
      label: p.label,
      position_in_last_frame: p.box,
      max_shift_pct_after_freeze: Math.round(Math.max(0, ...after)),
      first_measured_movement_s: firstMove < 0 ? -1 : times[start + 1 + firstMove],
    };
  });

  const { result, ms } = await sparkJSON({
    system: 'You are a strict but fair Freeze Dance referee. Trust what you see in the frames; use the measurements as supporting evidence. Small breathing is fine; arm, leg, head or body movement is not.',
    prompt: [
      start >= 0
        ? `The group froze at about ${times[start]}s. Judge only what happens after that, until the end of the clip.`
        : 'Find when the players stopped dancing (the freeze), then judge only what happens after that.',
      `Frames are in order, at times: ${window.map(f => f.t).join('s, ')}s.`,
      `Players (by box in the last frame) and measured outline movement: ${JSON.stringify(evidence)}`,
    ].join('\n'),
    images: window.map(f => f.dataUrl),
    schemaName: 'freeze_call',
    schema: FREEZE_SCHEMA,
    effort: 'medium',
  });

  // Compare the AI's call with the measurements; disagreement is shown as a close call.
  const calls = result.players.map(call => {
    const measured = evidence.find(e => e.label === call.label);
    const measuredMoved = measured ? measured.first_measured_movement_s >= 0 : null;
    return { ...call, box: measured?.position_in_last_frame, closeCall: measuredMoved !== null && measuredMoved !== call.moved };
  });

  // Everything the referee did, step by step, for the "Behind the scenes" panel.
  const behind = {
    steps: [
      { label: `Pulled ${frames.length} frames from the clip (2 per second)`, where: 'phone' },
      { label: `SAM 3.1 looked for people in all ${frames.length} frames at once`, ms: samMs },
      ...(ignored ? [{ label: `Ignored ${ignored} "person" ${ignored === 1 ? 'shape' : 'shapes'} too small to be a player (photos, posters, far away)` }] : []),
      { label: `Followed ${players.length} ${players.length === 1 ? 'player' : 'players'} from frame to frame and measured how much each outline moved` },
      { label: start >= 0 ? `Freeze found at ${times[start]}s: everyone's movement dropped below ${STILL_PCT}% for 2 frames in a row` : 'No clear freeze found; Muse Spark looked for it' },
      { label: `Muse Spark reviewed ${window.length} frames (${window[0].t}s–${window.at(-1).t}s) plus the measurements and made the call`, ms },
    ],
    frames: perFrame.map((f, j) => ({
      t: f.t,
      phase: start < 0 ? 'unknown' : j <= start ? 'before' : 'freeze',
      sentToSpark: window.some(w => w.t === f.t),
      players: players.map(p => ({ label: p.label, box: p.series[j], shift: Math.round(p.shifts[j]) })).filter(p => p.box),
      ignored: f.ignoredBoxes,
    })),
    evidence,
  };

  return {
    type: 'motion_after_cue',
    behind,
    freezeAt: start >= 0 ? times[start] : null,
    players: calls,
    reason: result.reason,
    meter: { times, players: players.map(p => ({ label: p.label, shifts: p.shifts.map(Math.round) })), stillBelow: STILL_PCT },
    sparkMs: ms,
  };
}

async function refereeLastFrame(round, frames) {
  const ref = round.referee;
  const call = await referee(frames.at(-1).dataUrl, { instruction: round.instruction, rule: ref.rule, sam_prompts: ref.sam_prompts });
  return {
    type: ref.type,
    lastFrameIndex: frames.length - 1,
    ...call,
    behind: {
      steps: [
        { label: `Pulled ${frames.length} frames from the clip; this game is judged on the last one (${frames.at(-1).t}s)`, where: 'phone' },
        { label: `SAM 3.1 looked for: ${ref.sam_prompts.join(', ')}`, ms: call.timing.samMs },
        { label: 'Code measured counts and stack height from the outlines' },
        { label: 'Muse Spark compared the photo and the measurements with the rule and made the call', ms: call.timing.sparkMs },
      ],
      evidence: call.evidence,
    },
  };
}

export async function refereeRound(round, frames) {
  const started = Date.now();
  const ref = round.referee;
  const result = ref.type === 'motion_after_cue'
    ? await refereeFreeze(round, frames)
    : await refereeLastFrame(round, frames);
  return { ...result, rule: ref.rule, totalMs: Date.now() - started };
}
