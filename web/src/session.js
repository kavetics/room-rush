// Test recording, on the development Mac only: every game's timeline and turns are saved so problems
// can be reviewed and fixed. Never runs in the hosted app. Failed saves never interrupt a game.
import { onReport } from './useCamera.js'

export const RECORDING = import.meta.env.DEV
const id = new Date().toISOString().replace(/[:.]/g, '-')
const started = performance.now()
let pending = []
let sending = Promise.resolve()
const RESEND_MS = 3000

function flush() {
  if (!pending.length) return
  const events = pending
  pending = []
  sending = sending.then(() => fetch(`/api/sessions/${id}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  })).then(res => {
    if (!res.ok) throw new Error('not saved')
  }).catch(() => {
    // The connection dropped: keep these events, and send them with the next ones. Losing them hides the problem.
    pending = [...events, ...pending]
    setTimeout(flush, RESEND_MS)
  })
}

/** Adds a line to this session's timeline. */
export function logEvent(type, data = {}) {
  if (!RECORDING) return
  pending.push({ at: new Date().toISOString(), s: Math.round(performance.now() - started) / 1000, type, ...data })
  flush()
}

if (RECORDING) onReport(message => logEvent('phone', { message }))

/** Saves one submitted attempt: the video with sound, frames, sound map and the referee's result. */
export function saveTurn({ game, round, player, name, attempt, clip, call, failure }) {
  if (!RECORDING) return
  const body = new FormData()
  body.append('meta', JSON.stringify({ game, round, player, name, attempt, call, failure, times: clip.frames.map(f => f.t) }))
  if (clip.envelope) body.append('envelope', JSON.stringify(clip.envelope))
  if (clip.blob) body.append('video', clip.blob, clip.blob.type.includes('mp4') ? 'turn.mp4' : 'turn.webm')
  clip.frames.forEach((f, i) => body.append('frames', f.blob, `f${i}.jpg`))
  const turn = `g${game}-r${round + 1}-p${player + 1}-a${attempt}`
  sending = sending.then(() => fetch(`/api/sessions/${id}/turns/${turn}`, { method: 'POST', body }))
    .then(res => logEvent('turn_saved', { turn, ok: res.ok }))
    .catch(err => logEvent('turn_save_failed', { turn, error: err.message }))
}
