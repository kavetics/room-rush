// Game design in two steps, so nobody waits:
//   1. designCards: quick game cards covering 1–25 players (ready before the host answers)
//   2. designRounds: full rounds for one game (generated while the host reads the cards)
import { sparkJSON } from './meta.js';

const GROUPS = [[2, 4], [5, 8], [9, 14], [15, 25]];
const SIZE_RANK = { small: 0, medium: 1, large: 2 };
// Most people who can move around at once without crowding, by open space.
const CAPACITY = { small: 6, medium: 12, large: 25 };
// Code-level safety net on top of the prompt. Any match rejects the game.
const BANNED = /alcohol|beer|wine|\bshots\b|drink(ing)? game|chug|climb|stand on|jump (off|from)|\bfire\b|lighter|candle|knife|scissors|\bstreet\b|\broad\b|traffic|swimming pool|dare to eat|blindfold.*run|over (their|the) (head|face)|cover(ing)? (their|the|your) (head|face)|pile on|dog ?pile|sardine|stack(ing)? (people|players)/i;

const SAFETY_RULES = [
  'Never involve alcohol, climbing, standing on furniture, fire, sharp objects, food dares, streets or water.',
  "Never cover anyone's face or head, never pile people on or under each other, and never squeeze many people onto one piece of furniture.",
  'Only use fixtures for their allowed actions. Keep every game away from the listed hazards.',
].join(' ');

const CARDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['games'],
  properties: {
    games: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'pitch', 'min_players', 'max_players', 'space_needed', 'seated_role', 'roles', 'uses'],
        properties: {
          title: { type: 'string', description: 'Fun game-show style name.' },
          pitch: { type: 'string', description: 'One exciting sentence the host reads out loud.' },
          min_players: { type: 'integer', minimum: 1, maximum: 25 },
          max_players: { type: 'integer', minimum: 1, maximum: 25 },
          space_needed: { type: 'string', enum: ['small', 'medium', 'large'] },
          seated_role: { type: 'string', description: 'A fun role for anyone who wants to stay seated (e.g. judge, scorekeeper). Empty if none.' },
          roles: { type: 'array', items: { type: 'string' }, description: 'e.g. host, referee, camera, team captain.' },
          uses: { type: 'array', items: { type: 'string' }, description: 'Props and fixtures from the report that the game uses.' },
        },
      },
    },
  },
};

const ROUNDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rounds'],
  properties: {
    rounds: {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['instruction', 'seconds', 'photo_check'],
        properties: {
          instruction: { type: 'string', description: 'What the host reads out loud: fun, punchy, at most 25 words. Do not restate safety rules; the Before-you-play checklist already covers them.' },
          seconds: { type: 'integer', minimum: 5, maximum: 15 },
          photo_check: {
            type: 'object',
            additionalProperties: false,
            required: ['what_to_photograph', 'sam_prompts', 'rule'],
            description: 'How the AI referee judges the round from ONE photo: counts, heights, presence or poses. Never motion or speed.',
            properties: {
              what_to_photograph: { type: 'string', description: 'At most 12 words.' },
              sam_prompts: { type: 'array', items: { type: 'string' }, description: 'Simple nouns, e.g. ["pillow", "person"].' },
              rule: { type: 'string', description: 'Measurable pass rule, at most 12 words, e.g. "Tallest pillow stack wins".' },
            },
          },
        },
      },
    },
  },
};

function inventoryOf(report) {
  return {
    setting: report.setting,
    space_size: report.spaceSize,
    props: report.props.map(p => `${p.name} ×${p.count}`),
    fixtures: report.fixtures.map(f => `${f.name} (${f.allowed_actions.join(', ')})`),
    keep_away_from: report.hazards.map(h => h.name),
  };
}

/** Step 1: about 8 quick cards across all player ranges. */
export async function designCards(report, { peopleSeen = 0, caution = '' } = {}) {
  const likely = GROUPS.find(([lo, hi]) => peopleSeen + 1 >= lo && peopleSeen + 1 <= hi) || GROUPS[0];
  const capacity = CAPACITY[report.spaceSize];

  const { result, ms } = await sparkJSON({
    system: [
      'You are the producer of a living-room game show. Design short, safe, hilarious games that use the actual things in the space.',
      SAFETY_RULES,
      caution ? `Location caution: ${caution} Include a role for it.` : '',
    ].join(' '),
    prompt: [
      `Space report: ${JSON.stringify(inventoryOf(report))}`,
      `Design 8 game cards covering ${GROUPS.map(([a, b]) => `${a}-${b}`).join(', ')} players, with extra options for ${likely[0]}-${likely[1]} (most likely).`,
      'Give each game the widest player range it honestly supports; ranges may overlap.',
      `At most ${capacity} people should be moving at once in this space; larger groups need team turns with the rest cheering.`,
    ].join('\n'),
    schemaName: 'game_cards',
    schema: CARDS_SCHEMA,
  });

  const games = result.games.filter(g =>
    g.min_players <= g.max_players &&
    SIZE_RANK[g.space_needed] <= SIZE_RANK[report.spaceSize] &&
    !BANNED.test(JSON.stringify(g)));
  return { games, rejected: result.games.length - games.length, ms };
}

/** Step 2: rounds for one chosen game. */
export async function designRounds(card, report, players) {
  const { result, ms } = await sparkJSON({
    system: [
      'You write the rounds for a living-room game show.',
      SAFETY_RULES,
      'Every round must be judgeable from a single photo (count, height, presence, pose).',
    ].join(' '),
    prompt: [
      `Space report: ${JSON.stringify(inventoryOf(report))}`,
      `Game: ${JSON.stringify(card)}`,
      `Players: ${players}. Write 2 short rounds (3 only if the game truly needs it). Each round lasts 5 to 15 seconds and is recorded as one video clip. Keep it fast and funny.`,
    ].join('\n'),
    schemaName: 'game_rounds',
    schema: ROUNDS_SCHEMA,
  });
  if (BANNED.test(JSON.stringify(result.rounds))) throw new Error('Generated rounds failed the safety check.');
  return { rounds: result.rounds, ms };
}

/** Instant, plain-code filter once the host confirms the head count. */
export function pickGames(games, { players, seated = 0 }) {
  const active = players - seated;
  return games.filter(g =>
    active >= g.min_players && active <= g.max_players &&
    (seated === 0 || g.seated_role));
}
