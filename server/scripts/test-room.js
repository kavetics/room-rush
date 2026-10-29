// Usage: npm run test:room -- ../test-photos/room1.jpg [more photos...]
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { toDataUrl } from '../src/meta.js';
import { readRoom } from '../src/room.js';

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const list = items => items.join(', ') || 'none';

for (const file of process.argv.slice(2)) {
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime) { console.log(`Skipping ${file} (convert HEIC to JPG first)`); continue; }
  const r = await readRoom(toDataUrl(await readFile(file), mime));
  console.log(`\n=== ${file}`);
  console.log(`Scene:     ${r.scene}`);
  console.log(`Setting:   ${r.setting} · ${r.spaceSize}`);
  console.log(`People:    ${r.people.seen} real, ${r.people.pictured} pictured${r.people.notes.length ? ` · notes: ${r.people.notes.join(' ')}` : ''}`);
  console.log(`Props:     ${list(r.props.map(p => `${p.name} ×${p.count}`))}`);
  console.log(`Fixtures:  ${list(r.fixtures.map(f => `${f.name} ×${f.count} [${f.allowed_actions.join(', ')}]`))}`);
  console.log(`Hazards:   ${list(r.hazards.map(h => `${h.name} ×${h.count} (${h.risk})`))}`);
  console.log(`Before you play:${r.beforeYouPlay.length ? '\n  - ' + r.beforeYouPlay.join('\n  - ') : ' nothing to clear'}`);
  console.log(`Rejected:  ${list(r.rejected)}  (Spark saw it, SAM couldn't confirm)`);
  console.log(`Timing:    Spark ${r.timing.sparkMs} ms · SAM ${r.timing.samMs} ms · total ${r.timing.totalMs} ms`);
}
