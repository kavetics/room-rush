// Simulates the real flow: photo → quick check → host takes N seconds to answer → games.
// Usage: npm run test:scan -- <photo> <players> [seated] [hostSeconds]
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { toDataUrl } from '../src/meta.js';
import { startScan, answerPlayers, getRounds } from '../src/scan.js';

const [file, players = '4', seated = '0', hostSeconds = '15'] = process.argv.slice(2);
const mime = { '.png': 'image/png', '.webp': 'image/webp' }[extname(file).toLowerCase()] || 'image/jpeg';
const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

const scan = await startScan(toDataUrl(await readFile(file), mime));
console.log(`[${secs()}] Location: ${scan.location.verdict.toUpperCase()} (${scan.location.locationType}). ${scan.location.reason}${scan.location.suggestion ? ` → ${scan.location.suggestion}` : ''}`);
if (scan.status === 'unsafe') process.exit(0);
console.log(`[${secs()}] Ask host: "${scan.question}"`);

console.log(`[${secs()}] ...host takes ${hostSeconds}s to count heads...`);
await new Promise(r => setTimeout(r, Number(hostSeconds) * 1000));
console.log(`[${secs()}] Host answers: ${players} playing, ${seated} seated`);

const result = await answerPlayers(scan.id, { players: Number(players), seated: Number(seated) });
console.log(`[${secs()}] Games shown. Host waited ${(result.waitedMs / 1000).toFixed(1)}s after answering.${result.fallback ? ' (fallback design)' : ''}`);
console.log(`Background: ${result.events.map(e => `${e.event} @${(e.atMs / 1000).toFixed(1)}s`).join(' · ')}`);
if (result.beforeYouPlay.length) console.log(`Before you play: ${result.beforeYouPlay.join(' | ')}`);
if (result.peopleNotes.length) console.log(`Heads up: ${result.peopleNotes.join(' ')}`);
for (const g of result.games) {
  console.log(`\n${g.kind === 'classic' ? '🎯' : '🧪'} ${g.title} (${g.min_players}-${g.max_players} players, ${g.space_needed} space${g.seated_role ? `, seated: ${g.seated_role}` : ''})`);
  if (g.setup) console.log(`   Setup: ${g.setup}`);
  g.rounds?.forEach((r, i) => console.log(`   R${i + 1} (${r.seconds}s): ${r.instruction}\n       🧑‍⚖️ ${r.referee.rule} [${r.referee.type}: ${r.referee.sam_prompts.join(', ')}]`));
}

// Host reads the cards for a few seconds, then taps the first one.
const readSeconds = 8;
console.log(`\n[${secs()}] ...host reads the cards for ${readSeconds}s, then taps an AI experiment...`);
await new Promise(r => setTimeout(r, readSeconds * 1000));
const firstExperiment = result.games.findIndex(g => g.kind === 'experiment');
if (firstExperiment < 0) process.exit(0);
const { game, waitedMs } = await getRounds(scan.id, firstExperiment);
console.log(`[${secs()}] Rounds shown. Host waited ${(waitedMs / 1000).toFixed(1)}s after tapping.`);
game.rounds.forEach((r, i) => console.log(`   R${i + 1} (${r.seconds}s): ${r.instruction}\n       🧑‍⚖️ ${r.referee.rule} [SAM: ${r.referee.sam_prompts.join(', ')}]`));
