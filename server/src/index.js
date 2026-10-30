// Room Rush API server. Holds the API keys; the browser never talks to Meta directly.
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { toDataUrl } from './meta.js';
import { readRoom } from './room.js';
import { referee } from './referee.js';
import { startScan, getScan, answerPlayers, getRounds, getRound } from './scan.js';
import { refereeRound } from './roundReferee.js';
import { lookAtFrame } from './look.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { refereeCatch } from './catchReferee.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

const photoFrom = req => {
  if (!req.file) throw Object.assign(new Error('Attach a photo as "photo".'), { status: 400 });
  return toDataUrl(req.file.buffer, req.file.mimetype);
};

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/room', upload.single('photo'), async (req, res, next) => {
  try { res.json(await readRoom(photoFrom(req))); } catch (err) { next(err); }
});

// Fast path: location check + head-count question. Report and games continue in the background.
// Takes 1–10 frames: one photo, or the photos from a guided scan (8 around the room + the ceiling).
app.post('/api/scan', upload.array('frames', 10), async (req, res, next) => {
  try {
    if (!req.files?.length) throw Object.assign(new Error('Attach the scan as "frames".'), { status: 400 });
    const views = req.body.views ? JSON.parse(req.body.views) : undefined;
    res.json(await startScan(req.files.map(f => toDataUrl(f.buffer, f.mimetype)), { views }));
  } catch (err) { next(err); }
});

// Live labels during the sweep: one frame, quick SAM look. Not tied to a scan yet.
app.post('/api/look', upload.single('frame'), async (req, res, next) => {
  try {
    if (!req.file) throw Object.assign(new Error('Attach a frame as "frame".'), { status: 400 });
    res.json(await lookAtFrame(toDataUrl(req.file.buffer, req.file.mimetype)));
  } catch (err) { next(err); }
});

app.get('/api/scan/:id', (req, res) => {
  const scan = getScan(req.params.id);
  scan ? res.json(scan) : res.status(404).json({ error: 'Scan not found or expired.' });
});

app.post('/api/scan/:id/players', async (req, res, next) => {
  try { res.json(await answerPlayers(req.params.id, req.body)); } catch (err) { next(err); }
});

app.get('/api/scan/:id/games/:index', async (req, res, next) => {
  try { res.json(await getRounds(req.params.id, Number(req.params.index))); } catch (err) { next(err); }
});

app.post('/api/referee', upload.single('photo'), async (req, res, next) => {
  try {
    const challenge = JSON.parse(req.body.challenge || '{}');
    res.json(await referee(photoFrom(req), challenge));
  } catch (err) { next(err); }
});

// A recorded round: the phone uploads frames pulled from the clip, plus their times in seconds.
app.post('/api/scan/:id/games/:game/rounds/:round/referee', upload.array('frames', 40), async (req, res, next) => {
  try {
    const round = await getRound(req.params.id, Number(req.params.game), Number(req.params.round));
    const times = JSON.parse(req.body.times || '[]');
    if (!req.files?.length || times.length !== req.files.length) throw Object.assign(new Error('Send frames with matching times.'), { status: 400 });
    const frames = req.files.map((f, i) => ({ t: times[i], dataUrl: toDataUrl(f.buffer, f.mimetype) }));
    res.json(await refereeRound(round, frames));
  } catch (err) { next(err); }
});

// Clap Catch: one recorded turn, as frames with their times in seconds.
app.post('/api/clap-catch/referee', upload.array('frames', 70), async (req, res, next) => {
  try {
    const times = JSON.parse(req.body.times || '[]');
    if (!req.files?.length || times.length !== req.files.length) throw Object.assign(new Error('Send frames with matching times.'), { status: 400 });
    const envelope = req.body.envelope ? JSON.parse(req.body.envelope) : undefined;
    // One JSON line per step, so the phone can show the analysis as it happens.
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    const send = line => res.write(`${JSON.stringify(line)}\n`);
    try {
      const result = await refereeCatch(req.files.map((f, i) => ({ t: times[i], dataUrl: toDataUrl(f.buffer, f.mimetype) })), { envelope, onProgress: send });
      send({ step: 'done', result });
    } catch (err) {
      console.error(err);
      send({ step: 'error', error: err.message });
    }
    res.end();
  } catch (err) { next(err); }
});

// Development only: the phone reports what its camera is doing, since we can't see its screen.
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/client-log', (req, res) => {
    console.log(`[phone] ${String(req.body?.message).slice(0, 500)}`);
    res.json({ ok: true });
  });
}

// Development only: the voice-guided test mode saves labeled turns to the git-ignored test-photos folder.
if (process.env.NODE_ENV !== 'production') {
  const RUNS = new URL('../../test-photos/catch-runs/', import.meta.url).pathname;
  const safeId = id => {
    if (!/^[\w-]{1,60}$/.test(id)) throw Object.assign(new Error('Bad id.'), { status: 400 });
    return id;
  };
  app.post('/api/clap-catch/test/:run/:trial', upload.array('frames', 70), async (req, res, next) => {
    try {
      const dir = join(RUNS, safeId(req.params.run), `trial-${safeId(req.params.trial)}`);
      await mkdir(dir, { recursive: true });
      await Promise.all(req.files.map((f, i) => writeFile(join(dir, `f${String(i).padStart(3, '0')}.jpg`), f.buffer)));
      if (req.body.envelope) await writeFile(join(dir, 'envelope.json'), req.body.envelope);
      await writeFile(join(dir, 'label.json'), JSON.stringify({ label: req.body.label, style: req.body.style, claps: req.body.claps ? Number(req.body.claps) : null, times: JSON.parse(req.body.times) }, null, 2));
      res.json({ saved: req.files.length });
    } catch (err) { next(err); }
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message });
});

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`Room Rush API on http://localhost:${port}`));
