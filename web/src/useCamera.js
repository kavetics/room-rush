import { useEffect, useRef, useState } from 'react'

// Our camera rules. Always the 1× lens at 1× zoom: the ultra-wide's distortion throws off what the AI sees.
const CAMERA = {
  // Ask for 4:3, the shape iPhone photos use; the phone picks the closest it supports.
  width: 1920,
  height: 1440,
}

// iPhones list several back cameras; "Back Camera" is the plain 1× lens.
const isMainBackLens = label => /^back camera$/i.test(label) ||
  (/back|rear/i.test(label) && !/ultra|wide|tele|dual|triple|front/i.test(label))

// Tell the Mac what the camera is doing, since nobody there can see the phone's screen.
let reportListener = null
export const onReport = listener => { reportListener = listener }

export function report(message) {
  if (!import.meta.env.DEV) return
  reportListener?.(message)
  fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }), signal: AbortSignal.timeout(5000) }).catch(() => {})
}
if (import.meta.env.DEV) {
  report(`page ${location.search || '/'} · secure ${window.isSecureContext} · mediaDevices ${Boolean(navigator.mediaDevices)} · ${navigator.userAgent}`)
  window.addEventListener('error', e => report(`error: ${e.message}`))
  window.addEventListener('unhandledrejection', e => report(`rejected: ${e.reason?.name} ${e.reason?.message}`))
}

// Dev mode mounts components twice. Only one camera start runs at a time, or they can knock each other out.
let previousStart = Promise.resolve()

/** Starts a camera (back by default, optionally with the microphone) on a <video> element. */
export function useCamera({ audio = false, facing = 'environment' } = {}) {
  const video = useRef(null)
  const stream = useRef(null)
  const [status, setStatus] = useState('starting') // starting → ready | error
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('starting')
    previousStart = previousStart.catch(() => {}).then(() => (cancelled ? undefined : start()))
    previousStart.catch(err => {
      report(`camera failed: ${err.name} ${err.message}`)
      if (cancelled) return
      setError(cameraError(err))
      setStatus('error')
    })
    return () => {
      cancelled = true
      stream.current?.getTracks().forEach(t => t.stop())
      stream.current = null
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('insecure')
      report(`asking for camera, mic ${audio}`)
      let s = await open({ facingMode: { ideal: facing } })
      report(`got ${s.getTracks().map(t => `${t.kind}:${t.label}:${t.readyState}`).join(', ')}`)
      // Device names are only visible after permission is granted, so switch lenses second.
      const devices = await navigator.mediaDevices.enumerateDevices()
      const main = facing === 'environment' ? devices.find(d => d.kind === 'videoinput' && isMainBackLens(d.label)) : null
      report(`lenses ${devices.filter(d => d.kind === 'videoinput').map(d => d.label).join(' | ')} · picked ${main?.label}`)
      if (main && s.getVideoTracks()[0].getSettings().deviceId !== main.deviceId) {
        s.getTracks().forEach(t => t.stop())
        s = await open({ deviceId: { exact: main.deviceId } })
      }
      if (cancelled) return s.getTracks().forEach(t => t.stop())
      stream.current = s
      const track = s.getVideoTracks()[0]
      const caps = track.getCapabilities?.() ?? {}
      if (caps.zoom) await track.applyConstraints({ advanced: [{ zoom: Math.max(caps.zoom.min, 1) }] }).catch(() => {})
      // iPhone only plays live video by itself when it's muted and inline, set before play().
      const v = video.current
      v.muted = true
      v.setAttribute('muted', '')
      v.setAttribute('playsinline', '')
      v.srcObject = s
      // Don't let a stuck play() hide the screen's buttons; START tries playing again from the tap.
      await Promise.race([v.play(), new Promise(resolve => setTimeout(resolve, 3000))])
      report(`playing: ${v.videoWidth}×${v.videoHeight} paused ${v.paused} · ${s.getTracks().map(t => `${t.kind} ${t.readyState}${t.muted ? ' muted' : ''}`).join(', ')}`)
      setStatus('ready')
    }

    function open(device) {
      return navigator.mediaDevices.getUserMedia({
        audio,
        video: { ...device, width: { ideal: CAMERA.width }, height: { ideal: CAMERA.height } },
      })
    }
  }, [audio, facing, attempt])

  // Asking again from a tap: the browser can refuse a request made when the page loads, then allow this one.
  const retry = () => {
    setError(null)
    setStatus('starting')
    setAttempt(n => n + 1)
  }

  const stop = () => {
    stream.current?.getTracks().forEach(t => t.stop())
    stream.current = null
  }
  return { video, stream, status, error, stop, retry }
}

/** One still from the live feed (the whole camera frame), shrunk for upload. */
export function grabFrame(video, maxSide = 1280, quality = 0.85) {
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
}

/** Grabs frames while something is being recorded. stop() returns [{ t, blob }], t in seconds. */
export function sampleFrames(video, { fps = 4, maxSide = 960 } = {}) {
  const started = performance.now()
  const pending = []
  const take = () => {
    if (!video.videoWidth) return // camera not delivering pictures right now
    const t = Math.round((performance.now() - started) / 100) / 10
    pending.push(grabFrame(video, maxSide, 0.8).then(blob => ({ t, blob })))
  }
  take()
  const timer = setInterval(take, 1000 / fps)
  return {
    stop: async () => {
      clearInterval(timer)
      return (await Promise.all(pending)).filter(f => f.blob)
    },
  }
}

// Plain types first: a video-only codec string can fail once a microphone track is included.
const VIDEO_TYPES = ['video/mp4', 'video/webm']

/** Records the camera and microphone. stop() returns the video Blob. */
export function startRecording(stream) {
  const mimeType = VIDEO_TYPES.find(t => window.MediaRecorder?.isTypeSupported(t))
  const recorder = new MediaRecorder(stream, { ...(mimeType && { mimeType }), videoBitsPerSecond: 2_500_000 })
  const chunks = []
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data)
  recorder.start(1000)
  return {
    stop: () => new Promise(resolve => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }))
      recorder.stop()
    }),
  }
}

/**
 * The clip's loudness, one value per 10 ms, for the clap counter on the server.
 * Returns null if this phone can't decode the recording's sound.
 */
export async function loudnessEnvelope(blob) {
  try {
    // Offline: this runs in the background during other turns, and must not disturb the mic or the voice.
    const context = new OfflineAudioContext(1, 1, 44100)
    const audio = await context.decodeAudioData(await blob.arrayBuffer())
    const samples = audio.getChannelData(0)
    const step = Math.round(audio.sampleRate / 100)
    const envelope = []
    for (let i = 0; i < samples.length; i += step) {
      let peak = 0
      for (let j = i; j < Math.min(i + step, samples.length); j++) peak = Math.max(peak, Math.abs(samples[j]))
      envelope.push(Math.round(peak * 1000) / 1000)
    }
    return envelope
  } catch {
    return null
  }
}

/** Call directly inside a tap: iPhone only allows speech that starts from a tap, then allows the rest. */
export function unlockSpeech() {
  if (!window.speechSynthesis) return
  speechSynthesis.cancel()
  report(`voice unlock · voices ${speechSynthesis.getVoices().length}`)
  speechSynthesis.speak(new SpeechSynthesisUtterance('Okay'))
}

const MIC_TIMEOUT_MS = 3000

let permissionsAsked = null

/** One prompt for camera and mic together, from the host's tap, so nothing prompts mid-game. */
export function askCameraAndMic() {
  permissionsAsked ??= navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(stream => {
    stream.getTracks().forEach(t => t.stop())
    report('camera and mic allowed at start')
    return true
  }).catch(err => {
    report(`camera or mic refused at start: ${err.name}`)
    permissionsAsked = null // they can be asked again
    return false
  })
  return permissionsAsked
}

/**
 * Opens the mic for one recording: on iPhone an open mic can quiet the voice instructions, so it stays
 * closed while the app is talking. Resolves to null if it isn't ready in time; the turn then has no clap count.
 */
export async function openMic() {
  const asked = performance.now()
  const mic = await Promise.race([
    navigator.mediaDevices.getUserMedia({ audio: true }).catch(err => { report(`mic refused: ${err.name}`); return null }),
    new Promise(resolve => setTimeout(() => resolve(null), MIC_TIMEOUT_MS)),
  ])
  report(`mic ${mic ? 'on' : 'unavailable'} in ${Math.round(performance.now() - asked)} ms`)
  return mic
}

/** Records the camera plus an already open mic. stop() returns the video and closes the mic. */
export function startRecordingWithMic(stream, mic) {
  const combined = new MediaStream([...stream.getVideoTracks(), ...(mic?.getAudioTracks() ?? [])])
  const recorder = startRecording(combined)
  return {
    stop: async () => {
      const blob = await recorder.stop()
      mic?.getTracks().forEach(t => t.stop())
      return blob
    },
  }
}

/** Says something out loud. Resolves when finished, or after a few seconds if the phone stays silent. */
export function say(text) {
  return new Promise(resolve => {
    if (!window.speechSynthesis) return resolve()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.onstart = () => report(`voice started: ${text}`)
    const timer = setTimeout(resolve, 2500 + text.length * 90)
    utterance.onend = () => { clearTimeout(timer); resolve() }
    utterance.onerror = e => { report(`voice error: ${e.error}`); clearTimeout(timer); resolve() }
    speechSynthesis.speak(utterance)
  })
}

function cameraError(err) {
  if (err.message === 'insecure') return 'The camera needs the secure link (https://). Check the address and try again.'
  if (err.name === 'NotAllowedError') return 'The camera was blocked. Tap below and choose Allow. If it stays blocked, allow Camera and Microphone in iPhone Settings → Apps → your browser.'
  if (err.name === 'NotFoundError') return 'No camera found on this device.'
  return `Could not start the camera (${err.name || err.message}).`
}
