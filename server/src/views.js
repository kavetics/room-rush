// Tells Muse Spark how the scan photos relate: taken from one spot, turning right, then the ceiling.
export function describeViews(n, views = []) {
  if (n === 1) return 'There is one photo: frame 0.';
  const ceiling = views.map((v, i) => (v === 'ceiling' ? i : -1)).filter(i => i >= 0);
  return [
    `There are ${n} photos of the same space, numbered 0 to ${n - 1}, taken from one spot in the middle while turning right.`,
    'Neighboring photos overlap, so the same object often appears in more than one.',
    ceiling.length && `Frame ${ceiling.join(', ')} looks up at the ceiling: check it for ceiling fans, chandeliers, hanging lights and anything low overhead.`,
  ].filter(Boolean).join(' ');
}
