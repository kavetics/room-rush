// Read the space (indoor or outdoor): Muse Spark builds a report of props, fixtures, hazards,
// space and people notes; SAM 3.1 verifies and counts everything; plain code enforces safety rules.
import { segment, sparkJSON } from './meta.js';

const FIXTURE_ACTIONS = ['hide_behind', 'sit_on', 'tag_or_touch', 'place_items_on', 'use_as_boundary'];
const SEATS = /couch|sofa|chair|bench|futon|ottoman|bean ?bag|stool|recliner|loveseat/i;
const NO_TOUCH = /window|glass|mirror|tv|television|screen|lamp|pool|grill|fire|heater|stove|oven|stair|step|railing|balcony|deck edge/i;

const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scene', 'setting', 'space_size', 'props', 'fixtures', 'hazards', 'people_notes', 'real_person_indices'],
  properties: {
    scene: { type: 'string', description: 'One sentence describing the space and the vibe.' },
    setting: { type: 'string', enum: ['indoor', 'outdoor'] },
    space_size: { type: 'string', enum: ['small', 'medium', 'large'], description: 'Open space for moving around. Phone wide-angle lenses exaggerate size.' },
    props: {
      type: 'array',
      description: 'Movable objects that are safe to pick up, toss gently and play with.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'sam_prompt'],
        properties: {
          name: { type: 'string' },
          sam_prompt: { type: 'string', description: 'Simple generic noun, e.g. "pillow".' },
        },
      },
    },
    fixtures: {
      type: 'array',
      description: 'Furniture, structures and areas that stay in place.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'sam_prompt', 'allowed_actions'],
        properties: {
          name: { type: 'string' },
          sam_prompt: { type: 'string', description: 'Simple generic noun, e.g. "couch".' },
          allowed_actions: { type: 'array', items: { type: 'string', enum: FIXTURE_ACTIONS } },
        },
      },
    },
    hazards: {
      type: 'array',
      description: 'Anything that could hurt someone or get broken during an active game.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'sam_prompt', 'risk', 'fix', 'fix_type'],
        properties: {
          name: { type: 'string' },
          sam_prompt: { type: 'string', description: 'Simple generic noun, e.g. "bottle".' },
          risk: { type: 'string', description: 'Short, e.g. "could break and cut someone".' },
          fix: { type: 'string', description: 'What the host should do, e.g. "Move the glass bottles to the kitchen."' },
          fix_type: { type: 'string', enum: ['move_away', 'keep_clear'], description: 'move_away = carry it out of the play area; keep_clear = it stays, the game avoids it.' },
        },
      },
    },
    real_person_indices: {
      type: 'array',
      items: { type: 'integer' },
      description: 'Indices of the candidate person boxes that are real people physically in the space. Exclude people in paintings, photos, posters, statues, screens and mirror reflections.',
    },
    people_notes: {
      type: 'array',
      description: 'Only people who probably should NOT be asked to play (a baby, someone asleep, someone busy cooking). Describe their situation, never their appearance, age estimate or identity.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['note'],
        properties: { note: { type: 'string', description: 'e.g. "Someone appears to be asleep on the couch."' } },
      },
    },
  },
};

const SYSTEM = [
  'You help a party host turn a room or backyard into a game. Report only what is clearly visible.',
  'Hazards include anything glass, sharp, hot, heavy, fragile, electrical, or containing alcohol; trip hazards like cords and rugs with loose edges;',
  'and outdoors: pools, hot tubs, grills, fire pits, deck edges, steps, garden tools and uneven ground.',
  'Water and fire are always keep_clear. Furniture is never climbed or stood on; only seats may be sat on.',
  'Use simple, generic sam_prompt nouns and list each kind of thing once.',
].join(' ');

// Plain-code safety rules: the model's labels are suggestions, these are final.
function enforceSafety(fixtures) {
  return fixtures.map(f => ({
    ...f,
    allowed_actions: f.allowed_actions.filter(a =>
      !(a === 'sit_on' && !SEATS.test(f.name)) &&
      !(['tag_or_touch', 'place_items_on', 'hide_behind'].includes(a) && NO_TOUCH.test(f.name))),
  }));
}

const verify = (imageDataUrl, prompt) =>
  segment(imageDataUrl, prompt).catch(err => ({ prompt, count: 0, objects: [], error: err.message }));

export async function readRoom(imageDataUrl, { personBoxes } = {}) {
  const started = Date.now();

  // SAM finds anything person-shaped, including portraits and TV screens. Muse Spark sorts real from pictured.
  personBoxes ??= (await verify(imageDataUrl, 'person')).objects.map(o => o.box);
  const candidates = personBoxes.map((b, i) => `${i}: (${b.x1},${b.y1})-(${b.x2},${b.y2})`).join('; ') || 'none';

  const { result: report, ms: sparkMs } = await sparkJSON({
    system: SYSTEM,
    prompt: [
      'Build a report for a party game in this space: up to 6 props, up to 6 fixtures, any hazards, the space size, and notes on anyone who probably should not be asked to play.',
      `Candidate person boxes in pixel coordinates (x1,y1)-(x2,y2): ${candidates}. List which are real people in real_person_indices.`,
    ].join('\n'),
    images: [imageDataUrl],
    schemaName: 'space_report',
    schema: REPORT_SCHEMA,
  });
  const realPeople = personBoxes.filter((_, i) => report.real_person_indices.includes(i));

  // SAM 3.1 confirms and counts everything Muse Spark reported. Runs in parallel.
  const groups = { props: report.props, fixtures: enforceSafety(report.fixtures), hazards: report.hazards };
  const all = Object.entries(groups).flatMap(([group, items]) => items.map(item => ({ group, item })));
  const found = await Promise.all(all.map(a => verify(imageDataUrl, a.item.sam_prompt)));
  const counted = all.map(({ group, item }, i) => ({ group, ...item, count: found[i].count, boxes: found[i].objects.map(o => o.box) }));
  const pick = group => counted.filter(c => c.group === group && c.count > 0).map(({ group: _, ...c }) => c);

  const notes = report.people_notes.map(p => p.note);
  const hazards = pick('hazards');

  return {
    scene: report.scene,
    setting: report.setting,
    spaceSize: report.space_size,
    people: { seen: realPeople.length, boxes: realPeople, pictured: personBoxes.length - realPeople.length, notes },
    props: pick('props'),
    fixtures: pick('fixtures'),
    hazards,
    // Shown to the host before the first round.
    beforeYouPlay: hazards.map(h => h.fix),
    rejected: counted.filter(c => c.count === 0).map(c => c.name), // Spark saw it, SAM couldn't confirm it
    timing: { sparkMs, samMs: Math.max(0, ...found.map(f => f.ms || 0)), totalMs: Date.now() - started },
  };
}
