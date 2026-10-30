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
  return json(await fetch('/api/scan', { method: 'POST', body }));
}

// Live labels while scanning: a quick SAM look at one sweep frame.
export async function lookAtFrame(blob) {
  const body = new FormData();
  body.append('frame', blob, 'frame.jpg');
  return json(await fetch('/api/look', { method: 'POST', body }));
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
