// Step 1 after a photo: is this a safe place to play? Small, fast Muse Spark call.
// Plain code has the final say on location types that are never safe.
import { sparkJSON } from './meta.js';

const LOCATION_TYPES = [
  'home_indoor', 'backyard', 'park_or_field', 'cul_de_sac', 'driveway', 'other_open_space',
  'street_or_road', 'parking_lot', 'railroad', 'construction_site', 'water_edge', 'rooftop_or_balcony', 'other_unsafe',
];
const ALWAYS_MOVE = new Set(['street_or_road', 'parking_lot', 'railroad', 'construction_site', 'water_edge', 'rooftop_or_balcony', 'other_unsafe']);
// A car could still come, so these get a lookout role.
const ALWAYS_CAUTION = new Set(['cul_de_sac', 'driveway']);

const LOCATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['location_type', 'verdict', 'reason', 'suggestion', 'people_present'],
  properties: {
    location_type: { type: 'string', enum: LOCATION_TYPES },
    verdict: { type: 'string', enum: ['go', 'caution', 'move'] },
    reason: { type: 'string', description: 'One short sentence.' },
    people_present: { type: 'integer', minimum: 0, description: 'Real people physically in the space. Do not count people in paintings, photos, posters, statues, screens or mirror reflections.' },
    suggestion: { type: 'string', description: 'If caution: the precaution (e.g. "Assign a lookout for cars"). If move: where to go instead. Empty if go.' },
  },
};

export async function checkLocation(imageDataUrl) {
  const { result, ms } = await sparkJSON({
    system: 'You decide whether a place is safe for an active party game. Streets, roads, railroad tracks, parking lots, construction sites, water edges, rooftops and balconies are never safe, even if they look empty right now.',
    prompt: 'Is this a safe place to play an active party game?',
    images: [imageDataUrl],
    schemaName: 'location_check',
    schema: LOCATION_SCHEMA,
  });

  let { verdict, suggestion } = result;
  if (ALWAYS_MOVE.has(result.location_type)) {
    verdict = 'move';
    suggestion ||= 'Head to a backyard, park or indoor space instead.';
  } else if (ALWAYS_CAUTION.has(result.location_type) && verdict === 'go') {
    verdict = 'caution';
    suggestion ||= 'Assign a lookout to watch for cars.';
  }
  return { locationType: result.location_type, verdict, reason: result.reason, suggestion, peoplePresent: result.people_present, ms };
}
