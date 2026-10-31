// Room Scavenger: Muse Spark writes clues from what the scan verified in this room, the player walks off
// and shows what they found, and the AI judges it. Plain code decides what's safe and does the scoring.
import { segment, sparkJSON } from './meta.js';

// Never send anyone for these, whatever the model suggests.
const UNSAFE = /\b(glass|mirrors?|knife|knives|scissors|sharp|blades?|candles?|fire|lighters?|hot|stove|oven|heater|grill|alcohol|beer|wine|bottles?|medicine|pills?|cleaner|chemicals?|tv|television|screens?|monitors?|lamps?|fans?|stairs?|steps?|ladders?|windows?|outside|street|road|pets?|baby|child|climb|run|running|heavy|furniture|couch|sofa|tables?|chairs?)\b/i;

// Used if the room gives too little to work with, or a clue fails the safety check.
const BACKUP_CLUES = [
  { clue: 'Find something soft you could nap on.', sam_prompt: 'pillow' },
  { clue: 'Find something you can wear.', sam_prompt: 'clothing' },
  { clue: 'Find something with words on it.', sam_prompt: 'book' },
  { clue: 'Find something smaller than your hand.', sam_prompt: 'object' },
  { clue: 'Find something that makes you smile.', sam_prompt: 'object' },
  { clue: 'Find something red.', sam_prompt: 'object' },
  { clue: 'Find something round.', sam_prompt: 'object' },
  { clue: 'Find something fluffy.', sam_prompt: 'object' },
];

// Seated play: everything is on the player or within arm's reach. Nobody gets up.
const SEATED_BACKUP_CLUES = [
  { clue: 'Show something blue you are wearing.', sam_prompt: 'clothing' },
  { clue: 'Show something with buttons or a zipper.', sam_prompt: 'clothing' },
  { clue: 'Show something you can reach that is soft.', sam_prompt: 'object' },
  { clue: 'Show something that tells the time.', sam_prompt: 'watch' },
  { clue: 'Show something with a picture on it.', sam_prompt: 'object' },
  { clue: 'Show something shiny you have with you.', sam_prompt: 'object' },
  { clue: 'Show something smaller than your hand.', sam_prompt: 'object' },
  { clue: 'Show something red you can reach.', sam_prompt: 'object' },
];

const CLUES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['clues'],
  properties: {
    clues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['clue', 'sam_prompt', 'based_on'],
        properties: {
          clue: { type: 'string', description: 'A playful one-sentence clue under 12 words that starts with "Find". It describes a kind of thing, so more than one object could fit.' },
          sam_prompt: { type: 'string', description: 'Simple generic noun for what you expect, e.g. "pillow".' },
          based_on: { type: 'string', description: 'The item from the room list that inspired it.' },
        },
      },
    },
  },
};

/** count safe clues for this room: inspired by what was verified, with anything risky replaced. */
export async function writeClues(report, count, { seated = false } = {}) {
  if (seated) return writeSeatedClues(report, count);
  // Judge the thing itself, not where it sits: "ball on sofa" is a ball.
  const safeItems = (report?.props ?? []).filter(p => !UNSAFE.test(p.sam_prompt ?? p.name)).map(p => p.sam_prompt ?? p.name);
  const hazards = (report?.hazards ?? []).map(h => h.name);
  let written = [];
  if (safeItems.length) {
    const { result } = await sparkJSON({
      system: 'You write clues for a friendly indoor scavenger hunt at a party. Players walk, never run, and pick up small, light, soft, unbreakable things. Never ask for anything breakable, sharp, hot, heavy, electrical, alive, or belonging to someone personally.',
      prompt: [
        `Room: ${report.scene}`,
        `Things verified in this room: ${safeItems.join(', ')}.`,
        hazards.length && `Stay away from: ${hazards.join(', ')}.`,
        `Write ${count} different clues. Use the room's things as inspiration, so each clue could really be solved here.`,
      ].filter(Boolean).join('\n'),
      schemaName: 'scavenger_clues',
      schema: CLUES_SCHEMA,
    });
    written = result.clues;
  }
  const isSafe = c => !UNSAFE.test(`${c.clue} ${c.sam_prompt}`) && c.clue.length <= 90 && !hazards.some(h => c.clue.toLowerCase().includes(h.toLowerCase()));
  const seen = new Set();
  const good = written.filter(isSafe).filter(c => !seen.has(c.clue) && seen.add(c.clue))
    .map(c => ({ clue: c.clue, sam_prompt: c.sam_prompt, fromRoom: true }));
  const backups = BACKUP_CLUES.filter(b => !good.some(g => g.clue === b.clue)).map(b => ({ ...b, fromRoom: false }));
  return { clues: [...good, ...backups].slice(0, count), rejected: written.length - good.length };
}

async function writeSeatedClues(report, count) {
  let written = [];
  if (report) {
    const { result } = await sparkJSON({
      system: 'You write clues for a gentle seated game for older adults in a group. Nobody gets up. Every clue is solved with something they are wearing, carrying, or can reach from their seat. Never mention bodies, age, memory, health or anything that could embarrass someone. Never ask for anything breakable, sharp, hot, or personal like medication or a wallet.',
      prompt: [
        `Room: ${report.scene}`,
        `Write ${count} different, warm one-sentence clues under 12 words, each starting with "Show". Each should have many possible answers, so nobody is left out.`,
      ].join('\n'),
      schemaName: 'seated_clues',
      schema: CLUES_SCHEMA,
    });
    written = result.clues;
  }
  const personal = /\b(medic|pills?|wallet|purse|money|cards?|keys?|phone|teeth|dentures?|hearing aid|glasses)\b/i;
  const seen = new Set();
  const good = written.filter(c => !UNSAFE.test(`${c.clue} ${c.sam_prompt}`) && !personal.test(c.clue) && c.clue.length <= 90)
    .filter(c => !seen.has(c.clue) && seen.add(c.clue))
    .map(c => ({ clue: c.clue, sam_prompt: c.sam_prompt, fromRoom: true }));
  const backups = SEATED_BACKUP_CLUES.filter(b => !good.some(g => g.clue === b.clue)).map(b => ({ ...b, fromRoom: false }));
  return { clues: [...good, ...backups].slice(0, count), rejected: written.length - good.length };
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'item', 'first_shown_seconds', 'reason', 'confidence'],
  properties: {
    verdict: { type: 'string', enum: ['found', 'not_found', 'unclear'] },
    item: { type: 'string', description: 'What the player is showing, or "nothing".' },
    first_shown_seconds: { type: 'number', description: 'Time of the first frame clearly showing the item in their hands. Use -1 if never.' },
    reason: { type: 'string', description: 'One short, friendly sentence spoken to the player as "you". Never use he, she or other descriptions of the person.' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const MAX_SPARK_FRAMES = 12;

// Evenly through the turn, always including the end, where the item should be shown.
function pickFrames(frames) {
  if (frames.length <= MAX_SPARK_FRAMES) return frames;
  const step = (frames.length - 1) / (MAX_SPARK_FRAMES - 1);
  return Array.from({ length: MAX_SPARK_FRAMES }, (_, i) => frames[Math.round(i * step)]);
}

/** frames: [{ t, dataUrl }]. Faster finds score more: one point per second left, at least one. */
export async function judgeFind(frames, { challenge, seconds }) {
  const started = Date.now();
  const last = frames.at(-1);
  // SAM checks the end of the turn for the expected kind of thing; evidence, not the decision.
  const samStart = Date.now();
  const spotted = await segment(last.dataUrl, challenge.sam_prompt, { minConfidence: 0.4 }).catch(err => {
    if (/40[0-9]|50[0-9]/.test(err.message) && !/404/.test(err.message)) throw new Error(`The AI service refused the referee's request: ${err.message}`);
    return { count: 0, objects: [] };
  });
  const samMs = Date.now() - samStart;
  const chosen = pickFrames(frames);
  const { result, ms: sparkMs } = await sparkJSON({
    system: [
      'You referee a friendly scavenger game. A player was given a clue and should show the camera what they found, usually at the end of the clip. Some players stay seated and show something they are wearing or holding.',
      'They may leave the frame while searching: that is normal. Be generous: if the object reasonably fits the clue, it counts. Pointing to something they are wearing counts as showing it.',
      'found: clearly showing something that fits. not_found: showing nothing, or something that does not fit. unclear: you cannot see what they are holding.',
      'Other people may be in the frame: only judge the person showing the item.',
    ].join(' '),
    prompt: [
      `The clue: "${challenge.clue}"`,
      `Frames in time order, at ${chosen.map(f => `${f.t}s`).join(', ')}.`,
      `A detector looking for "${challenge.sam_prompt}" in the last frame found ${spotted.count}. It is often wrong or looking for the wrong word, so trust what you see.`,
    ].join('\n'),
    images: chosen.map(f => f.dataUrl),
    schemaName: 'scavenger_verdict',
    schema: VERDICT_SCHEMA,
    effort: 'medium',
  });

  // Plain code: safety and scoring.
  const unsafe = result.verdict === 'found' && UNSAFE.test(result.item);
  const call = unsafe ? 'not_found' : result.verdict;
  const shownAt = result.first_shown_seconds >= 0 ? result.first_shown_seconds : seconds;
  const score = call === 'found' ? Math.max(1, Math.ceil(seconds - shownAt)) : 0;
  return {
    call: call === 'found' ? 'found' : call === 'not_found' ? 'missed' : 'unclear',
    item: result.item,
    reason: unsafe ? `Nice try, but let's leave the ${result.item} where it is. Pick something safe to carry.` : result.reason,
    confidence: result.confidence,
    score,
    shownAt: call === 'found' ? shownAt : null,
    boxes: spotted.objects.map(o => o.box),
    claps: null,
    evidence: { framesWithBall: `${spotted.count} spotted at the end`, thrown: true, item: result.item },
    timing: { samCalls: 1, samMs, sparkMs, framesSentToSpark: chosen.length, totalMs: Date.now() - started },
  };
}
