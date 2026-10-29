// Usage: npm run test:referee -- <photo> "<instruction>" "<rule>" "<sam prompt>" ["<sam prompt>" ...]
// Example: npm run test:referee -- ../test-photos/tower.jpg "Build the tallest cup tower" "At least 6 cups stacked in one tower" "cup"
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { toDataUrl } from '../src/meta.js';
import { referee } from '../src/referee.js';

const [file, instruction, rule, ...sam_prompts] = process.argv.slice(2);
if (!file || !rule || !sam_prompts.length) {
  console.log('Usage: npm run test:referee -- <photo> "<instruction>" "<rule>" "<sam prompt>" [...]');
  process.exit(1);
}
const mime = { '.png': 'image/png', '.webp': 'image/webp' }[extname(file).toLowerCase()] || 'image/jpeg';
const call = await referee(toDataUrl(await readFile(file), mime), { instruction, rule, sam_prompts });

console.log(`\n${call.verdict === 'pass' ? '✅ PASS' : '❌ FAIL'}  (confidence ${call.confidence})`);
console.log(`Reason:   ${call.reason}`);
console.log(`Evidence: ${JSON.stringify(call.evidence)}`);
console.log(`Timing:   SAM ${call.timing.samMs} ms · Spark ${call.timing.sparkMs} ms · total ${call.timing.totalMs} ms`);
