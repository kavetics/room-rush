// Clap counting is plain code, no AI: a clap is a very sudden, loud spike in the sound.
// Input: the clip's loudness envelope from the phone, one value per 10 ms.
const MS_PER_SAMPLE = 10;
const REFRACTORY_MS = 110; // nobody claps faster than about 9 times a second
const LOOKBACK_MS = 60;
const RISE = 3; // a spike is at least 3× louder than the moment before it (speech rises slower)
const IGNORE_START_MS = 250; // the mic opening and the tail of the word "Go" make a spike here
const FLOOR_TIMES = 6; // and well above the room's background level
const PEAK_SHARE = 0.25; // and not tiny compared with the loudest sound in the clip

/** Returns [{ t, strength }] for every clap-like spike, t in seconds from the start of the clip. */
export function findSpikes(envelope) {
  if (!envelope?.length) return [];
  const sorted = [...envelope].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length / 2)];
  const peak = sorted.at(-1);
  const threshold = Math.max(floor * FLOOR_TIMES, peak * PEAK_SHARE, 0.01);
  const lookback = LOOKBACK_MS / MS_PER_SAMPLE;
  const spikes = [];
  let lastAt = -Infinity;
  for (let i = Math.max(1, IGNORE_START_MS / MS_PER_SAMPLE); i < envelope.length; i++) {
    const value = envelope[i];
    if (value < threshold || (i * MS_PER_SAMPLE) - lastAt < REFRACTORY_MS) continue;
    const before = envelope.slice(Math.max(0, i - lookback), i);
    const level = before.reduce((a, b) => a + b, 0) / before.length;
    if (value < level * RISE) continue;
    spikes.push({ t: Math.round(i * MS_PER_SAMPLE) / 1000, strength: Math.round(value * 1000) / 1000 });
    lastAt = i * MS_PER_SAMPLE;
  }
  return spikes;
}

const CATCH_SOUND_WINDOW = 0.4; // the ball landing in the hands also makes a spike
const BURST_GAP = 0.8; // claps come in one quick burst while the ball is up; a long gap means that burst is over
const CATCH_GAP_RATIO = 1.3; // the catch comes after a longer gap than the claps' own rhythm

/**
 * Claps that count: the first quick burst of sound after the throw, up to the catch. The catch time
 * is only rough (frames are 0.25 s apart), so the rhythm of the claps does most of the work:
 * - a long gap ends the burst, so claps after the catch don't count;
 * - a last spike near the catch, later than the rhythm, is the ball hitting the hands.
 * SAM can miss a fast throw: then everything up to the catch counts. With neither time, nothing is counted.
 */
export function countClaps(envelope, { thrownAt, caughtAt }) {
  const spikes = findSpikes(envelope);
  if (thrownAt == null && caughtAt == null) return { count: null, spikes, counted: [] };
  const start = thrownAt ?? -Infinity;
  const end = caughtAt ?? Infinity;
  const inWindow = spikes.filter(s => s.t > start && s.t <= end + CATCH_SOUND_WINDOW);
  const counted = [];
  for (const spike of inWindow) {
    if (counted.length && spike.t - counted.at(-1).t >= BURST_GAP) break;
    counted.push(spike);
  }
  if (caughtAt != null && counted.length >= 2 && Math.abs(counted.at(-1).t - caughtAt) <= CATCH_SOUND_WINDOW) {
    const gaps = counted.slice(1).map((s, i) => s.t - counted[i].t);
    const lastGap = gaps.at(-1);
    const rhythm = gaps.length > 1 ? Math.min(...gaps.slice(0, -1)) : null;
    if (rhythm != null && lastGap > rhythm * CATCH_GAP_RATIO) counted.pop();
  }
  return { count: counted.length, spikes, counted };
}
