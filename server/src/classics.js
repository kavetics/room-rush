// Curated classic party games. Rules, player ranges and referee checks are fixed and vetted by us;
// Muse Spark only adapts them to the room (which prop, where to play, the host's script).
import { sparkJSON } from './meta.js';

const SIZE_RANK = { small: 0, medium: 1, large: 2 };

// referee.type tells the referee what to measure from the round's clip:
//   motion_after_cue → frames after the cue; anyone who moves is out
//   holder_at_end   → last frame; whoever holds the prop
//   tallest_stack   → last frame; tallest standing stack of the prop
//   item_present    → last frame; who is holding the requested item
export const CLASSICS = [
  {
    id: 'freeze_dance',
    title: 'Freeze Dance',
    pitch: 'Dance like nobody\'s watching. When the music stops, FREEZE. The AI referee catches anyone who moves.',
    min_players: 2, max_players: 25, space_needed: 'small',
    prop: null,
    seated_role: 'DJ: starts and stops the music',
    roles: ['host', 'DJ', 'camera'],
    rounds: [
      { seconds: 15, instruction: 'Dance! When the music stops, freeze completely and hold it until the buzzer.', referee: { type: 'motion_after_cue', sam_prompts: ['person'], rule: 'Anyone who moves during the freeze is out.' } },
      { seconds: 15, instruction: 'Survivors only. Freeze in your silliest pose this time.', referee: { type: 'motion_after_cue', sam_prompts: ['person'], rule: 'Anyone who moves during the freeze is out.' } },
    ],
  },
  {
    id: 'hot_potato',
    title: 'Hot Potato',
    pitch: 'Pass it fast. When the buzzer hits, whoever is holding it is out.',
    min_players: 3, max_players: 15, space_needed: 'small',
    prop: { need: 'one soft, tossable object (ball, small pillow, plush toy, rolled-up socks)', count: 1 },
    seated_role: 'Timekeeper: hits the buzzer at a random moment',
    roles: ['host', 'timekeeper', 'camera'],
    rounds: [
      { seconds: 10, instruction: 'Stand in a circle and pass the {prop} hand to hand. No throwing at faces!', referee: { type: 'holder_at_end', sam_prompts: ['person', '{prop}'], rule: 'Whoever holds the {prop} at the buzzer is out.' } },
      { seconds: 10, instruction: 'Again, faster! Pass the {prop} the other way around the circle.', referee: { type: 'holder_at_end', sam_prompts: ['person', '{prop}'], rule: 'Whoever holds the {prop} at the buzzer is out.' } },
    ],
  },
  {
    id: 'tower_stack',
    title: 'Tower Stack',
    pitch: 'Teams race to build the tallest tower. Hands off at the buzzer. Only standing towers count.',
    min_players: 2, max_players: 12, space_needed: 'small',
    prop: { need: 'several soft stackable objects (pillows, cushions, plastic cups, folded blankets)', count: 3 },
    seated_role: 'Judge: calls the countdown',
    roles: ['host', 'judge', 'camera', 'team captains'],
    rounds: [
      { seconds: 15, instruction: 'Split into teams. Stack the {prop} as high as you can on the floor. Hands off at the buzzer!', referee: { type: 'tallest_stack', sam_prompts: ['{prop}'], rule: 'The tallest standing stack of {prop} wins.' } },
      { seconds: 15, instruction: 'Rematch! This time, build it using only one hand each.', referee: { type: 'tallest_stack', sam_prompts: ['{prop}'], rule: 'The tallest standing stack of {prop} wins.' } },
    ],
  },
  {
    id: 'scavenger_rush',
    title: 'Scavenger Rush',
    pitch: 'The AI names something in the room. Grab it and be back on the spot before the buzzer.',
    min_players: 2, max_players: 25, space_needed: 'small',
    prop: null, // the item to find is chosen from the room by the AI
    seated_role: 'Spotter: points out who made it back',
    roles: ['host', 'spotter', 'camera'],
    rounds: [
      { seconds: 15, instruction: 'Find {item} and get back to {home_base} before the buzzer. Walk, don\'t run!', referee: { type: 'item_present', sam_prompts: ['person', '{item_noun}'], rule: 'Everyone holding {item} at the buzzer scores.' } },
      { seconds: 15, instruction: 'New item: find {item_2} and get back to {home_base}!', referee: { type: 'item_present', sam_prompts: ['person', '{item_2_noun}'], rule: 'Everyone holding {item_2} at the buzzer scores.' } },
    ],
  },
];

const adaptSchema = propNames => ({
  type: 'object',
  additionalProperties: false,
  required: ['games'],
  properties: {
    games: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'fits', 'why_not', 'prop', 'prop_noun', 'play_area', 'home_base', 'setup', 'items'],
        properties: {
          id: { type: 'string' },
          fits: { type: 'boolean', description: 'False if the room lacks what the game needs.' },
          why_not: { type: 'string', description: 'Empty if it fits.' },
          prop: { type: 'string', enum: [...propNames, ''], description: 'The prop from the report the game should use. Empty if the game needs none or none fits.' },
          prop_noun: { type: 'string', description: 'Simple noun for that prop, e.g. "pillow". Empty if none.' },
          play_area: { type: 'string', description: 'Where to play, using real things in the room, e.g. "on the rug".' },
          home_base: { type: 'string', description: 'A fixture to use as home base or finish line, e.g. "the couch".' },
          setup: { type: 'string', description: 'One or two short sentences the host reads before round 1, including what to keep clear of.' },
          items: {
            type: 'array',
            description: 'Scavenger Rush only: 2 things visible in the room for players to fetch, each {label, noun}. Empty for other games.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'noun'],
              properties: { label: { type: 'string', description: 'e.g. "a pillow"' }, noun: { type: 'string', description: 'e.g. "pillow"' } },
            },
          },
        },
      },
    },
  },
});

const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, key) => vars[key] ?? m);

/** One Muse Spark call adapts every classic to this room. Runs in the background before the host answers. */
export async function adaptClassics(report) {
  const inventory = {
    space_size: report.spaceSize,
    setting: report.setting,
    props: report.props.map(p => `${p.name} ×${p.count}`),
    fixtures: report.fixtures.map(f => `${f.name} (${f.allowed_actions.join(', ')})`),
    keep_away_from: report.hazards.map(h => h.name),
  };
  const playable = CLASSICS.filter(g => SIZE_RANK[g.space_needed] <= SIZE_RANK[report.spaceSize]);

  const { result, ms } = await sparkJSON({
    system: 'You set up classic party games in a real room. Use only props and fixtures from the report, never anything on the keep-away list. Keep it short and clear for a host to read aloud.',
    prompt: [
      `Room report: ${JSON.stringify(inventory)}`,
      `Games: ${JSON.stringify(playable.map(g => ({ id: g.id, title: g.title, needs: g.prop?.need ?? 'no props' })))}`,
      'For each game, decide if it fits this room and adapt it.',
    ].join('\n'),
    schemaName: 'adapted_classics',
    schema: adaptSchema(report.props.map(p => p.name)),
  });

  const propNames = new Set(report.props.map(p => p.name));
  const propCounts = Object.fromEntries(report.props.map(p => [p.name, p.count]));

  const games = playable.flatMap(game => {
    const a = result.games.find(x => x.id === game.id);
    if (!a?.fits) return [];
    // Code checks the AI's choices against what SAM actually verified.
    if (game.prop && (!propNames.has(a.prop) || propCounts[a.prop] < game.prop.count)) return [];
    if (game.id === 'scavenger_rush' && a.items.length < 2) return [];

    const vars = {
      prop: a.prop_noun || a.prop, home_base: a.home_base,
      item: a.items[0]?.label, item_noun: a.items[0]?.noun,
      item_2: a.items[1]?.label, item_2_noun: a.items[1]?.noun,
    };
    return [{
      ...game,
      kind: 'classic',
      setup: a.setup,
      play_area: a.play_area,
      uses: [a.prop, a.home_base].filter(Boolean),
      rounds: game.rounds.map(r => ({
        seconds: r.seconds,
        instruction: fill(r.instruction, vars),
        referee: { ...r.referee, sam_prompts: r.referee.sam_prompts.map(p => fill(p, vars)), rule: fill(r.referee.rule, vars) },
      })),
    }];
  });
  return { games, ms };
}
