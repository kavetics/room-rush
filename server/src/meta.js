// Thin client for the Meta Model API (OpenAI-compatible). Uses Node's built-in fetch.
const BASE_URL = process.env.META_API_BASE_URL || 'https://api.meta.ai/v1';

export const MODELS = {
  spark: 'muse-spark-1.3', // never use -contributor variants: photos contain people
  sam: 'sam-3.1',
  image: 'muse-image-1.0',
};

// Meta's API can briefly answer 404 model_not_found for a valid model (a known issue on their side),
// then recover with the same request. Other errors are real, so they fail right away.
const MODEL_RETRY_DELAYS_MS = [500, 1000, 2000];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function post(path, body) {
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MODEL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok && !data.error) return { data, ms: Date.now() - started };

    const msg = data.error?.message || res.statusText;
    if (res.status === 404 && attempt < MODEL_RETRY_DELAYS_MS.length) {
      console.warn(`Meta API ${path}: 404 for ${body.model}, retry ${attempt + 1} of ${MODEL_RETRY_DELAYS_MS.length}`);
      await sleep(MODEL_RETRY_DELAYS_MS[attempt] * (0.75 + Math.random() / 2));
      continue;
    }
    throw new Error(`Meta API ${path} failed (${res.status}): ${msg}`);
  }
}

export function toDataUrl(buffer, mime = 'image/jpeg') {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

// SAM 3.1 returns tokens like:
// <0f>0<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..;c=..|><|mask;x=0;y=0;c=..;data=H,W,!payload|>,1<|box...
const BOX_RE = /<\|box;([^|]*)\|>/g;

function parseFields(str) {
  return Object.fromEntries(str.split(';').map(kv => {
    const i = kv.indexOf('=');
    return [kv.slice(0, i), Number(kv.slice(i + 1))];
  }));
}

/** Find every instance of one concept (e.g. "person", "red cup") in an image. */
export async function segment(imageDataUrl, prompt, { minConfidence = 0.5 } = {}) {
  const { data, ms } = await post('/responses', {
    model: MODELS.sam,
    store: false,
    metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
    input: [{
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: prompt },
        { type: 'input_image', image_url: imageDataUrl },
      ],
    }],
  });
  const text = data.output?.[0]?.content?.[0]?.text || '';
  const objects = [...text.matchAll(BOX_RE)]
    .map(m => parseFields(m[1]))
    .filter(b => (b.c ?? 1) >= minConfidence)
    .map(b => ({
      box: { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 },
      width: b.x2 - b.x1 + 1,
      height: b.y2 - b.y1 + 1,
      confidence: b.c,
      imageSize: { width: b.w, height: b.h },
    }));
  return { prompt, count: objects.length, objects, ms };
}

/** Track one concept through a video. Returns boxes per frame: [{ frame, boxes: [{x1,y1,x2,y2}] }]. */
export async function segmentVideo(videoDataUrl, prompt) {
  const { data, ms } = await post('/responses', {
    model: MODELS.sam,
    store: false,
    input: [{
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: prompt },
        { type: 'input_video', video_url: videoDataUrl },
      ],
    }],
  });
  const text = data.output?.[0]?.content?.[0]?.text || '';
  const frames = text.split('\n').filter(Boolean).map(line => ({
    frame: Number(line.match(/^<(\d+)f>/)?.[1]),
    boxes: [...line.matchAll(BOX_RE)].map(m => parseFields(m[1])),
  }));
  return { prompt, frames, ms };
}

/** Ask Muse Spark for JSON that matches a schema. Images are optional data URLs. */
export async function sparkJSON({ system, prompt, images = [], videos = [], schemaName, schema, effort = process.env.SPARK_EFFORT || 'low' }) {
  const content = [
    { type: 'text', text: prompt },
    ...images.map(url => ({ type: 'image_url', image_url: { url } })),
    ...videos.map(url => ({ type: 'video_url', video_url: { url } })),
  ];
  const { data, ms } = await post('/chat/completions', {
    model: MODELS.spark,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content },
    ],
    response_format: { type: 'json_schema', json_schema: { name: schemaName, schema, strict: true } },
    ...(effort && { reasoning_effort: effort }),
  });
  const raw = data.choices?.[0]?.message?.content || '{}';
  return { result: JSON.parse(raw), ms, usage: data.usage };
}
