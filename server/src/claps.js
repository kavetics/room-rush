// Clap counting is plain code, no AI: a clap is a very sudden, loud spike in the sound.
// Input: the clip's loudness envelope from the phone, one value per 10 ms.
const MS_PER_SAMPLE = 10;
const REFRACTORY_MS = 110; // nobody claps faster than about 9 times a second
const LOOKBACK_MS = 60;
const RISE = 3; // a spike is at least 3× louder than the moment before it (speech rises slower)
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
  for (let i = 1; i < envelope.length; i++) {
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

/**
 * Claps that count: after the throw and before the catch. The last spike right at the catch is
 * the ball hitting the hands, so it isn't a clap. Without a throw time, nothing is counted.
 */
export function countClaps(envelope, { thrownAt, caughtAt }) {
  const spikes = findSpikes(envelope);
  if (thrownAt == null) return { count: null, spikes, counted: [] };
  const end = caughtAt ?? Infinity;
  const counted = spikes.filter(s => s.t > thrownAt && s.t <= end + CATCH_SOUND_WINDOW);
  if (caughtAt != null && counted.length && Math.abs(counted.at(-1).t - caughtAt) <= CATCH_SOUND_WINDOW) counted.pop();
  return { count: counted.length, spikes, counted };
}
