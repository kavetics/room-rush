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

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message });
});

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`Room Rush API on http://localhost:${port}`));
