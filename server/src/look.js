// Live labels while the host scans: each sweep frame gets a quick SAM 3.1 look for a fixed list
// of party-relevant things. SAM can't name what it sees, so we ask for each thing by name.
// Muse Spark's full report after the scan stays the source of truth.
import { segment } from './meta.js';

export const LOOK_FOR = [
  { prompt: 'person', label: 'person' },
  { prompt: 'ball', label: 'ball' },
  { prompt: 'pillow', label: 'pillow' },
  { prompt: 'couch', label: 'couch' },
  { prompt: 'chair', label: 'chair' },
  { prompt: 'table', label: 'table' },
  // Hazards for games with throwing: things that break or hang overhead.
  { prompt: 'lamp', label: 'lamp', hazard: true },
  { prompt: 'television', label: 'TV', hazard: true },
  { prompt: 'ceiling fan', label: 'ceiling fan', hazard: true },
  { prompt: 'staircase', label: 'stairs', hazard: true }, // "stairs" scored only 0.55 on a clear staircase
];

export async function lookAtFrame(imageDataUrl) {
  const started = Date.now();
  const found = await Promise.all(LOOK_FOR.map(item =>
    segment(imageDataUrl, item.prompt, { minConfidence: 0.6 })
      .then(r => ({ ...item, count: r.count, ms: r.ms }))
      .catch(err => ({ ...item, count: 0, error: err.message }))));
  return {
    found: found.filter(f => f.count > 0).map(({ label, count, hazard }) => ({ label, count, hazard: Boolean(hazard) })),
    calls: found.length,
    failed: found.filter(f => f.error).length,
    slowestMs: Math.max(0, ...found.map(f => f.ms || 0)),
    ms: Date.now() - started,
  };
}
