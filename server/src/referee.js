// AI referee: SAM 3.1 gathers measurable evidence, plain code computes the numbers,
// Muse Spark makes the call from the photo plus that evidence.
import { segment, sparkJSON } from './meta.js';

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reason', 'confidence'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    reason: { type: 'string', description: 'One or two short sentences a party host would read out loud.' },
    confidence: { type: 'number', description: '0 to 1' },
  },
};

// Measurements are computed in code, never by the model.
function measure({ count, objects }) {
  if (!count) return { count: 0 };
  const top = Math.min(...objects.map(o => o.box.y1));
  const bottom = Math.max(...objects.map(o => o.box.y2));
  const imageHeight = objects[0].imageSize.height;
  return {
    count,
    stackHeightPx: bottom - top + 1,
    stackHeightPctOfPhoto: Math.round(((bottom - top + 1) / imageHeight) * 100),
  };
}

/**
 * challenge: { instruction, sam_prompts: ["red cup", "person"], rule: "at least 6 cups stacked in one tower" }
 */
export async function referee(imageDataUrl, challenge) {
  const started = Date.now();
  const found = await Promise.all(challenge.sam_prompts.map(p => segment(imageDataUrl, p)));
  const evidence = Object.fromEntries(found.map(f => [f.prompt, measure(f)]));

  const { result, ms: sparkMs } = await sparkJSON({
    system: 'You are a fair, upbeat party-game referee. Judge only what the photo and the measured evidence support. If the evidence contradicts what you think you see, trust the measurements and say so.',
    prompt: [
      `Challenge: ${challenge.instruction}`,
      `Pass rule: ${challenge.rule}`,
      `Measured evidence from the segmentation model: ${JSON.stringify(evidence)}`,
      'Did the players complete the challenge?',
    ].join('\n'),
    images: [imageDataUrl],
    schemaName: 'referee_verdict',
    schema: VERDICT_SCHEMA,
  });

  return {
    ...result,
    evidence,
    boxes: Object.fromEntries(found.map(f => [f.prompt, f.objects.map(o => o.box)])), // for the on-screen overlay
    timing: { samMs: Math.max(...found.map(f => f.ms)), sparkMs, totalMs: Date.now() - started },
  };
}
