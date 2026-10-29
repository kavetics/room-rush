// One scan per photo. Each step starts as early as possible and hides behind something the host is doing:
//   photo → location check + people count (~3 s) → host counts heads
//     meanwhile: full report → classics adapted to the room + AI experiment cards (in parallel)
//   host answers → matching cards shown instantly
//     meanwhile: rounds for those games, while the host reads and picks
import { randomUUID } from 'node:crypto';
import { segment } from './meta.js';
import { checkLocation } from './location.js';
import { readRoom } from './room.js';
import { designCards, designRounds, pickGames } from './games.js';
import { adaptClassics } from './classics.js';

const scans = new Map();
const TTL_MS = 60 * 60 * 1000;

function headCountQuestion(peopleSeen) {
  return (peopleSeen === 0
    ? "I don't see anyone in the photo yet. How many people are playing, including you?"
    : `I see ${peopleSeen} ${peopleSeen === 1 ? 'person' : 'people'}. Plus you, that's ${peopleSeen + 1}. How many are playing?`)
    + ' Anyone want a seated or referee role instead?';
}

const notFound = () => Object.assign(new Error('Scan not found or expired.'), { status: 404 });

/** Returns as soon as the location check and people count are done. */
export async function startScan(imageDataUrl) {
  const id = randomUUID();
  const started = Date.now();
  const scan = { id, started, status: 'checking', events: [], rounds: new Map() };
  scans.set(id, scan);
  setTimeout(() => scans.delete(id), TTL_MS).unref();
  scan.mark = event => scan.events.push({ event, atMs: Date.now() - started });

  const [location, people] = await Promise.all([
    checkLocation(imageDataUrl),
    segment(imageDataUrl, 'person').catch(() => ({ count: 0, objects: [] })),
  ]);
  scan.mark('location_checked');
  scan.location = location;
  // SAM also counts people in paintings and on screens; Muse Spark's count of real people drives the question.
  scan.peopleSeen = location.peoplePresent;

  if (location.verdict === 'move') {
    scan.status = 'unsafe'; // skip everything else: faster and cheaper
    return publicView(scan);
  }

  scan.status = 'awaiting_players';
  scan.question = headCountQuestion(scan.peopleSeen);

  // Background, not awaited: full report, then classics and experiments side by side.
  scan.ready = (async () => {
    scan.report = await readRoom(imageDataUrl, { personBoxes: people.objects.map(o => o.box) });
    scan.mark('report_ready');
    const caution = location.verdict === 'caution' ? location.suggestion : '';
    const [classics, experiments] = await Promise.all([
      adaptClassics(scan.report).then(r => { scan.mark('classics_ready'); return r.games; }),
      // Experiments are optional: if invention fails, the classics still work.
      designCards(scan.report, { peopleSeen: scan.peopleSeen, caution })
        .then(r => { scan.mark('experiments_ready'); return r.games.map(g => ({ ...g, kind: 'experiment' })); })
        .catch(() => []),
    ]);
    scan.cards = [...classics, ...experiments];
  })().catch(err => { scan.error = err.message; scan.mark('failed'); });

  return publicView(scan);
}

/** Host answered. Returns matching cards and starts writing their rounds in the background. */
export async function answerPlayers(id, { players, seated = 0 }) {
  const scan = scans.get(id);
  if (!scan) throw notFound();
  if (scan.status === 'unsafe') throw Object.assign(new Error('This location was marked unsafe.'), { status: 409 });

  const answeredAt = Date.now();
  await scan.ready;
  if (scan.error) throw new Error(scan.error);
  const waitedMs = Date.now() - answeredAt;

  let games = pickGames(scan.cards, { players, seated });
  let fallback = false;
  if (!games.length) {
    // Rare: nothing fits. Design cards for this exact group instead.
    const exact = await designCards(scan.report, { peopleSeen: players - 1 });
    games = pickGames(exact.games.map(g => ({ ...g, kind: 'experiment' })), { players, seated });
    fallback = true;
  }

  scan.status = 'games_ready';
  scan.players = players;
  scan.shown = games;
  games.forEach((card, index) => card.kind === 'experiment' && roundsFor(scan, index)); // warm up while the host reads

  return {
    games,
    fallback,
    peopleNotes: scan.report.people.notes,
    beforeYouPlay: scan.report.beforeYouPlay,
    waitedMs,
    events: scan.events,
  };
}

// One rounds request per game, shared by the warm-up and the host's tap. One retry if the safety check fails.
function roundsFor(scan, index) {
  if (!scan.rounds.has(index)) {
    const card = scan.shown[index];
    if (card.rounds) return Promise.resolve({ rounds: card.rounds }); // classics come with vetted rounds
    const attempt = () => designRounds(card, scan.report, scan.players).then(r => ({
      // Same shape as classics: experiments are judged from the round's last frame.
      rounds: r.rounds.map(({ photo_check, ...round }) => ({
        ...round,
        referee: { type: 'last_frame', sam_prompts: photo_check.sam_prompts, rule: photo_check.rule, look_for: photo_check.what_to_photograph },
      })),
    }));
    const job = attempt().catch(attempt).then(r => { scan.mark(`rounds_${index}_ready`); return r; });
    job.catch(() => scan.rounds.delete(index)); // let a later tap try again
    scan.rounds.set(index, job);
  }
  return scan.rounds.get(index);
}

/** Host tapped a game. Usually already done by now. */
export async function getRounds(id, index) {
  const scan = scans.get(id);
  if (!scan) throw notFound();
  if (!scan.shown?.[index]) throw Object.assign(new Error('Game not found.'), { status: 404 });
  const tappedAt = Date.now();
  const { rounds } = await roundsFor(scan, index);
  return { game: { ...scan.shown[index], rounds }, waitedMs: Date.now() - tappedAt };
}

export function getScan(id) {
  const scan = scans.get(id);
  return scan && publicView(scan);
}

function publicView(scan) {
  return {
    id: scan.id,
    status: scan.status,
    location: scan.location,
    peopleSeen: scan.peopleSeen,
    question: scan.question,
    reportReady: Boolean(scan.report),
    gamesReady: Boolean(scan.cards),
    peopleNotes: scan.report?.people.notes ?? [],
    // What the AI saw, so the UI can draw it on the photo.
    report: scan.report && {
      scene: scan.report.scene,
      setting: scan.report.setting,
      spaceSize: scan.report.spaceSize,
      people: scan.report.people.boxes,
      props: scan.report.props.map(({ name, count, boxes }) => ({ name, count, boxes })),
      fixtures: scan.report.fixtures.map(({ name, count, boxes, allowed_actions }) => ({ name, count, boxes, allowed_actions })),
      hazards: scan.report.hazards.map(({ name, count, boxes, fix }) => ({ name, count, boxes, fix })),
      beforeYouPlay: scan.report.beforeYouPlay,
    },
    error: scan.error,
    events: scan.events,
  };
}
