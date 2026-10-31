// Calls to the Room Rush server. In development Vite forwards /api to localhost:8787.

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// One photo, or the photos from a guided scan. views says which way each one faces ('side' | 'ceiling').
export async function startScan(frames, views = frames.map(() => 'side')) {
  const body = new FormData();
  frames.forEach((blob, i) => body.append('frames', blob, `room-${i}.jpg`));
  body.append('views', JSON.stringify(views));
  // A phone that drops off Wi-Fi can leave this hanging forever, so give up and try again.
  for (let attempt = 1; ; attempt++) {
    try {
      return await json(await fetch('/api/scan', { method: 'POST', body, signal: AbortSignal.timeout(SCAN_LIMIT_MS) }));
    } catch (err) {
      if (!isConnectionError(err)) throw err;
      if (attempt >= SCAN_ATTEMPTS) throw new Error("Couldn't reach the app from this phone. Check that the phone and the computer are on the same Wi-Fi or hotspot, then try again.");
    }
  }
}

// Live labels while scanning: a quick SAM look at one sweep frame.
export async function lookAtFrame(blob) {
  const body = new FormData();
  body.append('frame', blob, 'frame.jpg');
  return json(await fetch('/api/look', { method: 'POST', body }));
}

const SCAN_LIMIT_MS = 30000;
const SCAN_ATTEMPTS = 2;
const REFEREE_SILENCE_MS = 30000;
const SAVE_LIMIT_MS = 45000;

/** Connection trouble, as opposed to the server answering with an error: worth sending again. */
export const isConnectionError = err => err.name === 'TypeError' || err.name === 'AbortError' || err.name === 'TimeoutError';

// Clap Catch: one recorded turn, as frames with their times.
export async function refereeCatch(frames, envelope, onProgress = () => {}, { review = false } = {}) {
  const body = new FormData();
  if (review) body.append('review', 'true');
  if (envelope) body.append('envelope', JSON.stringify(envelope));
  frames.forEach((f, i) => body.append('frames', f.blob, `f${i}.jpg`));
  body.append('times', JSON.stringify(frames.map(f => f.t)));
  // A phone that drops off Wi-Fi can leave a request hanging for minutes with no error.
  // If nothing has arrived for a while, give up on it so the caller can send it again.
  const controller = new AbortController();
  let silence;
  const stillAlive = () => {
    clearTimeout(silence);
    silence = setTimeout(() => controller.abort(), REFEREE_SILENCE_MS);
  };
  stillAlive();
  const res = await fetch('/api/clap-catch/referee', { method: 'POST', body, signal: controller.signal });
  stillAlive();
  if (!res.ok) { clearTimeout(silence); return json(res); } // throws with the server's message
  // The server sends one JSON line per step while it works.
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let result = null;
  for (;;) {
    const { value, done } = await reader.read();
    stillAlive();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.step === 'error') { clearTimeout(silence); throw new Error(event.error); }
      if (event.step === 'done') result = event.result;
      else onProgress(event);
    }
  }
  clearTimeout(silence);
  if (!result) throw new TypeError('The connection ended before the referee finished.');
  return result;
}

// Room Scavenger: clues for this room, and judging one turn. An empty scan id gets general clues.
export async function scavengerClues(scanId, count, seated) {
  return json(await fetch('/api/scavenger/clues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scanId, count, seated }),
    signal: AbortSignal.timeout(SAVE_LIMIT_MS),
  }));
}

export async function judgeFind(frames, challenge, seconds) {
  const body = new FormData();
  frames.forEach((f, i) => body.append('frames', f.blob, `f${i}.jpg`));
  body.append('times', JSON.stringify(frames.map(f => f.t)));
  body.append('challenge', JSON.stringify(challenge));
  body.append('seconds', String(seconds));
  return json(await fetch('/api/scavenger/judge', { method: 'POST', body, signal: AbortSignal.timeout(SAVE_LIMIT_MS) }));
}

// Test mode: save one labeled turn.
export async function saveTestTrial(run, trial, { label, style, claps }, frames, envelope) {
  const body = new FormData();
  if (envelope) body.append('envelope', JSON.stringify(envelope));
  frames.forEach((f, i) => body.append('frames', f.blob, `f${i}.jpg`));
  body.append('label', label);
  body.append('style', style);
  if (claps != null) body.append('claps', claps);
  body.append('times', JSON.stringify(frames.map(f => f.t)));
  return json(await fetch(`/api/clap-catch/test/${run}/${trial}`, { method: 'POST', body, signal: AbortSignal.timeout(SAVE_LIMIT_MS) }));
}

export async function getScan(id) {
  return json(await fetch(`/api/scan/${id}`));
}

export async function answerPlayers(id, players, seated) {
  return json(await fetch(`/api/scan/${id}/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ players, seated }),
  }));
}

export async function getGame(id, index) {
  return json(await fetch(`/api/scan/${id}/games/${index}`));
}

export async function refereeRound(scanId, gameIndex, roundIndex, frames) {
  const body = new FormData()
  frames.forEach((f, i) => body.append('frames', f.blob, `f${i}.jpg`))
  body.append('times', JSON.stringify(frames.map(f => f.t)))
  return json(await fetch(`/api/scan/${scanId}/games/${gameIndex}/rounds/${roundIndex}/referee`, { method: 'POST', body }))
}

/**
 * Pull still frames out of a recorded clip, on the phone, so only small images are uploaded.
 * Plays the clip silently at high speed and grabs frames as they go by: decoding in order is
 * far cheaper than jumping around, which is very slow for iPhone HEVC video.
 * Returns { frames: [{ t, blob, url }], ms, method }.
 */
export async function extractFrames(file, { fps = 2, maxSide = 640, maxSeconds = 20, speed = 8, onProgress } = {}) {
  const started = performance.now()
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  // iOS decodes more reliably when the video is in the page; keep it invisible.
  Object.assign(video.style, { position: 'fixed', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' })
  document.body.appendChild(video)
  video.src = URL.createObjectURL(file)

  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve
      video.onerror = () => reject(new Error('Could not read that video.'))
    })
    const duration = Math.min(video.duration, maxSeconds)
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight))
    const width = Math.round(video.videoWidth * scale)
    const height = Math.round(video.videoHeight * scale)
    const targets = []
    for (let t = 0; t <= duration + 0.001; t += 1 / fps) targets.push(Math.min(t, duration - 0.05))

    const grab = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(video, 0, 0, width, height)
      return canvas
    }

    let captured
    let method = 'playback'
    try {
      captured = await grabWhilePlaying(video, targets, grab, speed, onProgress)
    } catch {
      method = 'seeking' // fallback: slower, but works everywhere
      captured = []
      for (const t of targets) {
        video.currentTime = t
        await new Promise(resolve => { video.onseeked = resolve })
        captured.push({ t, canvas: grab() })
        onProgress?.(captured.length, targets.length)
      }
    }

    const frames = await Promise.all(captured.map(async ({ t, canvas }) => {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8))
      return { t: Math.round(t * 10) / 10, blob, url: URL.createObjectURL(blob) }
    }))
    return { frames, ms: Math.round(performance.now() - started), method }
  } finally {
    URL.revokeObjectURL(video.src)
    video.remove()
  }
}

// Each time a new frame is shown during playback, capture it if we've reached the next target time.
function grabWhilePlaying(video, targets, grab, speed, onProgress) {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return Promise.reject(new Error('unsupported'))
  return new Promise((resolve, reject) => {
    const captured = []
    const stopAt = targets.at(-1)
    let done = false
    const onFrame = (_now, meta) => {
      while (captured.length < targets.length && meta.mediaTime >= targets[captured.length] - 0.02) {
        captured.push({ t: targets[captured.length], canvas: grab() })
        onProgress?.(captured.length, targets.length)
      }
      if (captured.length >= targets.length || meta.mediaTime >= stopAt) return finish()
      video.requestVideoFrameCallback(onFrame)
    }
    const finish = () => {
      if (done) return
      done = true
      video.pause()
      // Anything not reached (very end of the clip) gets the last frame shown.
      while (captured.length < targets.length) captured.push({ t: targets[captured.length], canvas: grab() })
      resolve(captured)
    }
    video.onended = finish
    video.playbackRate = speed
    video.requestVideoFrameCallback(onFrame)
    video.play().catch(reject)
  })
}

/** Shrink phone photos to 1280px before upload: faster upload and fewer AI tokens. */
export async function shrinkPhoto(file, maxSide = 1280) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}
