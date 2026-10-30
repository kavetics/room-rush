import { useEffect, useRef, useState } from 'react'
import { SCAN, cameraDirection, turnTo } from './sweep.js'
import { lookAtFrame } from './api.js'

// Our camera rules. Always the 1× lens at 1× zoom: the ultra-wide's distortion throws off what the AI sees.
const CAMERA = {
  // Ask for 4:3, the shape iPhone photos use; the phone picks the closest it supports.
  width: 1920,
  height: 1440,
  frameMaxSide: 1280, // photos sent to the AI
}

// iPhones list several back cameras; "Back Camera" is the plain 1× lens.
const isMainBackLens = label => /^back camera$/i.test(label) ||
  (/back|rear/i.test(label) && !/ultra|wide|tele|dual|triple|front/i.test(label))

const CEILING = SCAN.sides // the step after the 8 side photos

/**
 * Full-screen guided room scan. The host stands in the middle of the room and taps Start;
 * the app guides them to 8 directions (every 45°, turning right) and then the ceiling, and takes
 * a photo by itself whenever the phone is lined up and still. Each photo also gets a quick SAM
 * look, so labels ("couch ×2", "lamp") pop up during the scan. Always the 1× lens, no zoom.
 * onCapture({ frames: Blob[], views: ('side' | 'ceiling')[], labels, compass })
 */
export default function Camera({ title, hint, onCapture, onBack, onUpload }) {
  const video = useRef(null)
  const stream = useRef(null)
  const direction = useRef(null) // { heading, pitch } from the motion sensor
  const scan = useRef(null)
  const [state, setState] = useState('starting') // starting → ready → scanning → saving | error
  const [error, setError] = useState(null)
  const [live, setLive] = useState(null) // the guide right now, for the UI
  const [labels, setLabels] = useState({}) // label → { count, hazard, at }
  const [flash, setFlash] = useState(false)
  const [toast, setToast] = useState(null)

  function stop() {
    clearInterval(scan.current?.timer)
    stream.current?.getTracks().forEach(t => t.stop())
    stream.current = null
  }

  useEffect(() => {
    let cancelled = false
    const onOrientation = e => { direction.current = cameraDirection(e) }
    window.addEventListener('deviceorientation', onOrientation)
    start().catch(err => {
      if (cancelled) return
      setError(cameraError(err))
      setState('error')
    })
    return () => {
      cancelled = true
      window.removeEventListener('deviceorientation', onOrientation)
      stop()
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('insecure')
      let s = await open({ facingMode: { ideal: 'environment' } })
      // Device names are only visible after permission is granted, so switch lenses second.
      const devices = await navigator.mediaDevices.enumerateDevices()
      const main = devices.find(d => d.kind === 'videoinput' && isMainBackLens(d.label))
      if (main && s.getVideoTracks()[0].getSettings().deviceId !== main.deviceId) {
        s.getTracks().forEach(t => t.stop())
        s = await open({ deviceId: { exact: main.deviceId } })
      }
      if (cancelled) return s.getTracks().forEach(t => t.stop())
      stream.current = s
      const track = s.getVideoTracks()[0]
      const caps = track.getCapabilities?.() ?? {}
      if (caps.zoom) await track.applyConstraints({ advanced: [{ zoom: Math.max(caps.zoom.min, 1) }] }).catch(() => {})
      video.current.srcObject = s
      await video.current.play()
      setState('ready')
    }

    function open(device) {
      return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...device, width: { ideal: CAMERA.width }, height: { ideal: CAMERA.height } },
      })
    }
  }, [])

  // One still from the live feed (the whole camera frame), shrunk for upload.
  function grabFrame() {
    const v = video.current
    const scale = Math.min(1, CAMERA.frameMaxSide / Math.max(v.videoWidth, v.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(v.videoWidth * scale)
    canvas.height = Math.round(v.videoHeight * scale)
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height)
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  }

  // Take the photo for this step and send it for a quick look. Same rule as the report:
  // a thing's count is its highest count in any one photo, never the sum.
  function takeShot(s) {
    const view = s.step === CEILING ? 'ceiling' : 'side'
    const blob = grabFrame()
    s.frames.push(blob)
    s.views.push(view)
    s.looks.push(blob.then(lookAtFrame).then(({ found }) => {
      setLabels(prev => {
        const next = { ...prev }
        for (const f of found) {
          const old = next[f.label]
          if (!old || f.count > old.count) next[f.label] = { count: f.count, hazard: f.hazard, at: old?.at ?? Date.now() }
        }
        s.labels = next
        return next
      })
    }).catch(() => {}))
    setFlash(true)
    setTimeout(() => setFlash(false), 150)
    navigator.vibrate?.(30)
    const sides = s.views.filter(v => v === 'side').length
    setToast(view === 'ceiling' ? 'Ceiling ✓' : `Got it ✓ ${sides} of ${SCAN.sides}`)
    setTimeout(() => setToast(null), 900)
    s.step = view === 'ceiling' ? CEILING + 1 : s.step + 1
    s.stepStartedAt = performance.now()
    s.steadySince = null
    if (s.step > CEILING) finish()
  }

  function startScan() {
    if (state !== 'ready' || !video.current?.videoWidth) return
    const d = direction.current
    const s = {
      compass: d?.heading != null,
      base: d?.heading ?? 0, // the first photo is wherever they're facing now
      step: 0,
      frames: [],
      views: [],
      looks: [],
      labels: {},
      stepStartedAt: performance.now(),
      steadySince: null,
      history: [], // recent { heading, pitch, t } for the "hold still" check
    }
    setLabels({})
    scan.current = s
    s.timer = setInterval(() => (s.compass ? guideByCompass(s) : guideByTimer(s)), 100)
    setState('scanning')
  }

  // With a compass: show where to turn, and take the photo once lined up and still.
  function guideByCompass(s) {
    if (s.finishing) return
    const now = performance.now()
    const d = direction.current
    if (!d) return
    // Still = the phone stayed within a few degrees over the last moment. Sensor readings jitter,
    // so this looks at the spread over a short window, not reading-to-reading changes.
    // For the ceiling only the tilt counts: pointing up, a small hand wobble swings the compass a lot.
    s.history = [...s.history.filter(h => now - h.t < SCAN.steadyWindowMs), { ...d, t: now }]
    const spread = values => (values.length ? Math.max(...values) - Math.min(...values) : 0)
    const pitchSpread = spread(s.history.map(h => h.pitch))
    const headings = s.history.map(h => h.heading).filter(h => h != null)
    const headingSpread = spread(headings.map(h => turnTo(headings[0], h)))
    const still = pitchSpread < SCAN.steadySpreadDeg && (s.step === CEILING || headingSpread < SCAN.steadySpreadDeg)

    let aligned, guide, offset
    if (s.step === CEILING) {
      aligned = d.pitch >= SCAN.ceilingDeg
      // The dot sits where to aim (above the ring) and slides down into it as the phone tilts up.
      offset = { x: 0, y: -Math.min(140, Math.max(0, SCAN.ceilingDeg - d.pitch) * 3) }
      guide = aligned ? 'Hold still…' : 'Now point the camera up at the ceiling ↑'
    } else {
      const target = (s.base + s.step * SCAN.stepDeg) % 360
      const diff = d.heading == null ? null : turnTo(d.heading, target)
      const level = Math.abs(d.pitch) < SCAN.levelDeg
      aligned = diff != null && level && Math.abs(diff) <= SCAN.alignDeg
      offset = { x: diff == null ? 0 : Math.max(-140, Math.min(140, diff * 3)), y: 0 }
      guide = !level ? 'Hold the phone up straight, facing the wall'
        : aligned ? 'Hold still…'
        : diff > 0 ? 'Turn slowly to the right →'
        : '← Too far, back to the left a little'
    }
    if (aligned && still) s.steadySince ??= now
    else s.steadySince = null
    const hold = s.steadySince ? Math.min(1, (now - s.steadySince) / SCAN.steadyMs) : 0
    setLive({ step: s.step, sides: s.views.filter(v => v === 'side').length, guide, aligned, hold, offset, compass: true })
    if (hold >= 1) takeShot(s)
  }

  // Without a compass: timed prompts. Turn, hold still, photo.
  function guideByTimer(s) {
    if (s.finishing) return
    const elapsed = performance.now() - s.stepStartedAt
    const turnMs = s.step === 0 ? 0 : SCAN.timedTurnMs
    const turning = elapsed < turnMs
    const hold = turning ? 0 : Math.min(1, (elapsed - turnMs) / SCAN.timedHoldMs)
    const guide = turning
      ? (s.step === CEILING ? 'Now point the camera up at the ceiling ↑' : 'Turn a little to the right →')
      : 'Hold still…'
    setLive({ step: s.step, sides: s.views.filter(v => v === 'side').length, guide, aligned: !turning, hold, offset: { x: 0, y: 0 }, compass: false })
    if (hold >= 1) takeShot(s)
  }

  // "Done turning" after enough sides: skip to the ceiling photo. "Skip ceiling": finish without it.
  function skipAhead() {
    const s = scan.current
    if (!s) return
    if (s.step < CEILING) {
      s.step = CEILING
      s.stepStartedAt = performance.now()
      s.steadySince = null
    } else finish()
  }

  async function finish() {
    const s = scan.current
    if (!s || s.finishing) return
    s.finishing = true
    clearInterval(s.timer)
    setState('saving')
    const frames = (await Promise.all(s.frames)).filter(Boolean)
    // Give the last looks a moment to land; never hold up the scan for them.
    await Promise.race([Promise.all(s.looks), new Promise(r => setTimeout(r, 1500))])
    stop()
    onCapture({ frames, views: s.views, labels: s.labels, compass: s.compass })
  }

  function cancel() {
    const s = scan.current
    if (s) {
      clearInterval(s.timer)
      scan.current = null
    }
    setLive(null)
    setLabels({})
    setState('ready')
  }

  const scanning = state === 'scanning'
  const onCeiling = live?.step === CEILING

  return (
    <div className={`camera ${scanning ? 'is-scanning' : ''}`}>
      {/* The video fills the screen; the "scanner" look and controls float on top. */}
      <video ref={video} className="camera-video" playsInline muted />
      {state !== 'starting' && state !== 'error' && <ScannerOverlay scanning={scanning} />}
      {scanning && live && <Reticle live={live} />}
      {flash && <div className="camera-flash" />}
      {toast && <p className="camera-toast">{toast}</p>}
      {state === 'starting' && <p className="camera-msg">Starting camera…</p>}
      {state === 'saving' && <p className="camera-msg">Scan complete ✓</p>}
      {state === 'error' && <p className="camera-msg">{error}</p>}

      <div className="camera-top">
        <button className="camera-icon" onClick={scanning ? cancel : () => { stop(); onBack() }} aria-label={scanning ? 'Cancel scan' : 'Back'}>
          {scanning ? '✕' : '←'}
        </button>
        <span>{scanning ? <><span className="rec-dot" /> SCANNING</> : title}</span>
        <span />
      </div>
      {scanning && live && <ScanProgress live={live} />}

      <div className="camera-bottom">
        <SpottedLabels labels={labels} />
        <p className="camera-hint">{scanning ? live?.guide : hint}</p>
        {state === 'ready' && <button className="shutter" onClick={startScan}>START<br />SCAN</button>}
        {scanning && (
          <div className="scan-actions">
            {!onCeiling && live?.sides >= SCAN.minSidesForDone && <button className="secondary-dark" onClick={skipAhead}>Done turning</button>}
            {onCeiling && <button className="secondary-dark" onClick={skipAhead}>Skip ceiling</button>}
          </div>
        )}
        {onUpload && state === 'ready' && <button className="link camera-upload" onClick={onUpload}>Upload a photo instead</button>}
      </div>
    </div>
  )
}

// Corner brackets, a faint mesh, and a sweeping scan line: it looks like a scanner.
function ScannerOverlay({ scanning }) {
  return (
    <div className="scanner" aria-hidden="true">
      <div className="scanner-mesh" />
      {['tl', 'tr', 'bl', 'br'].map(c => <span key={c} className={`bracket ${c}`} />)}
      {scanning && <div className="scan-line" />}
    </div>
  )
}

// Center ring plus a target dot: line the dot up with the ring and hold still. The ring fills as you hold.
function Reticle({ live }) {
  const { offset, aligned, hold } = live
  return (
    <div className="reticle-wrap" aria-hidden="true">
      <div className={`reticle ${aligned ? 'aligned' : ''}`} style={{ '--hold': hold }} />
      {live.compass && (
        <div className="target-dot" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
          {live.step === CEILING && !aligned && <span className="tilt-up">↑</span>}
        </div>
      )}
    </div>
  )
}

// 8 side photos plus the ceiling: filled as they're taken.
function ScanProgress({ live }) {
  return (
    <div className="scan-progress">
      {Array.from({ length: SCAN.sides }, (_, i) => (
        <span key={i} className={i < live.sides ? 'done' : i === live.step ? 'now' : ''} />
      ))}
      <span className={`ceiling ${live.step > CEILING ? 'done' : live.step === CEILING ? 'now' : ''}`}>↑</span>
    </div>
  )
}

// What SAM has spotted so far, newest last. Hazards in yellow.
const ICONS = { person: '🧍', ball: '⚽', pillow: '🛏️', couch: '🛋️', chair: '🪑', table: '🪵', lamp: '💡', TV: '📺', 'ceiling fan': '🌀', stairs: '🪜' }
function SpottedLabels({ labels }) {
  const list = Object.entries(labels).sort((a, b) => a[1].at - b[1].at)
  if (!list.length) return null
  return (
    <div className="spotted" aria-live="polite">
      {list.map(([label, l]) => (
        <span key={label} className={`spot ${l.hazard ? 'hazard' : ''}`}>
          {ICONS[label] ?? '•'} {label}{l.count > 1 ? ` ×${l.count}` : ''}
        </span>
      ))}
    </div>
  )
}

function cameraError(err) {
  if (err.message === 'insecure') return 'The camera needs the secure link (https://). Check the address and try again.'
  if (err.name === 'NotAllowedError') return 'Camera access is blocked. Allow it in your browser settings (iPhone: Settings → Apps → Safari → Camera), then reload.'
  if (err.name === 'NotFoundError') return 'No camera found on this device.'
  return `Could not start the camera (${err.name || err.message}).`
}
