// Test recording, development only: each game's timeline and turns, saved to the git-ignored
// test-photos/sessions folder so problems can be reviewed and replayed through the referee.
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import multer from 'multer';

const ROOT = new URL('../../test-photos/sessions/', import.meta.url).pathname;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const safeId = id => {
  if (!/^[\w-]{1,60}$/.test(id)) throw Object.assign(new Error('Bad id.'), { status: 400 });
  return id;
};

export function addSessionRoutes(app) {
  app.post('/api/sessions/:id/events', async (req, res, next) => {
    try {
      const dir = join(ROOT, safeId(req.params.id));
      await mkdir(dir, { recursive: true });
      await appendFile(join(dir, 'timeline.jsonl'), (req.body.events ?? []).map(e => `${JSON.stringify(e)}\n`).join(''));
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  app.post('/api/sessions/:id/turns/:turn', upload.fields([{ name: 'video', maxCount: 1 }, { name: 'frames', maxCount: 70 }]), async (req, res, next) => {
    try {
      const dir = join(ROOT, safeId(req.params.id), 'turns', safeId(req.params.turn));
      await mkdir(dir, { recursive: true });
      const video = req.files.video?.[0];
      await Promise.all([
        writeFile(join(dir, 'meta.json'), req.body.meta || '{}'),
        req.body.envelope && writeFile(join(dir, 'envelope.json'), req.body.envelope),
        video && writeFile(join(dir, `video${extname(video.originalname)}`), video.buffer),
        ...(req.files.frames ?? []).map((f, i) => writeFile(join(dir, `f${String(i).padStart(3, '0')}.jpg`), f.buffer)),
      ]);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });
}
