import { useEffect, useRef, useState } from 'react'
import { startScan, getScan, shrinkPhoto } from './api.js'
import Camera from './Camera.jsx'
import ClapCatch from './ClapCatch.jsx'
import { hasSavedGame } from './savedGame.js'
import VoiceTest from './VoiceTest.jsx'
import CatchTest from './CatchTest.jsx'
import { askMotionPermission } from './sweep.js'
import { prepareVoice } from './voice.js'
import { askCameraAndMic } from './useCamera.js'
import { logEvent, RECORDING } from './session.js'
import './App.css'

const LAYERS = [
  { key: 'people', label: 'People', className: 'people' },
  { key: 'props', label: 'Props', className: 'prop' },
  { key: 'fixtures', label: 'Fixtures', className: 'fixture' },
  { key: 'hazards', label: 'Hazards', className: 'hazard' },
]

export default function App() {
  // Accuracy test modes: open the app with ?test=catch (voice, no sound recorded) or ?test=claps
  const test = new URLSearchParams(window.location.search).get('test')
  if (test === 'catch' || test === 'claps') return <CatchTest claps={test === 'claps'} />
  if (test === 'high') return <CatchTest high />
  if (test === 'turn') return <div className="app"><ClapCatch players={2} onBack={() => { window.location.search = '?test=menu' }} /></div>
  if (test === 'voice') return <VoiceTest />
  if (test === 'scavenger') return <div className="app"><ClapCatch players={2} gameType="scavenger" onBack={() => { window.location.search = '?test=menu' }} /></div>
  if (test === 'menu') return <TestMenu />
  return <Game />
}

// Shortcuts for testing, so nobody has to scan a room first. Open the app with ?test=menu
function TestMenu() {
  const links = [
    ['turn', '👏 Play Clap Catch', 'Names, rounds, turns, scoreboard and the full report. No scan.'],
    ['scavenger', '🔎 Play Room Scavenger', 'No scan, so it uses general clues instead of your room.'],
    ['voice', '🔊 Voice test', 'Can the phone speak while filming, with the mic open or closed? About 2 minutes.'],
    ['catch', '🗣️ Catch test', '20 throws called out by voice, about 4 minutes. No mic.'],
    ['high', '🚀 High throw test', '10 throws that leave the top of the frame, about 4 minutes. Turn off any ceiling fan first.'],
    ['claps', '🔢 Clap test', '13 throws with the mic on, about 2.5 minutes. Read the screen.'],
  ]
  return (
    <div className="app">
      <main>
        <h1>Test menu</h1>
        {links.map(([key, title, about]) => (
          <a key={key} className="card game test-link" href={`?test=${key}`}>
            <h3>{title}</h3>
            <p className="meta">{about}</p>
          </a>
        ))}
        <a className="link" href="/">Full app →</a>
      </main>
    </div>
  )
}

function Game() {
  const [screen, setScreen] = useState('home')
  const [frameUrls, setFrameUrls] = useState([])
  const [spotted, setSpotted] = useState({}) // live labels from the sweep
  const [scan, setScan] = useState(null) // the room check, arriving in the background
  const [players, setPlayers] = useState(2)
  const [error, setError] = useState(null)
  const [canResume, setCanResume] = useState(false)
  const [gameType, setGameType] = useState('clap')
  const fileInput = useRef(null)

  useEffect(() => { hasSavedGame().then(setCanResume) }, [])

  // The room report keeps arriving while the host answers.
  useEffect(() => {
    if (!scan?.id || scan.reportReady || scan.error || scan.status === 'unsafe') return
    const timer = setInterval(() => getScan(scan.id).then(setScan).catch(() => {}), 1200)
    return () => clearInterval(timer)
  }, [scan?.id, scan?.reportReady, scan?.error, scan?.status])

  // Stop anyone from playing somewhere unsafe, as soon as we know; otherwise go on once they've answered.
  useEffect(() => {
    if (!['count', 'room-check'].includes(screen) || !scan) return
    if (scan.status === 'unsafe') {
      logEvent('blocked', { reason: 'unsafe', type: scan.location?.locationType })
      setScreen('unsafe')
    } else if (scan.report?.spaceSize === 'small') {
      logEvent('blocked', { reason: 'small' })
      setScreen('too-small')
    } else if (screen === 'room-check' && (scan.reportReady || scan.error)) {
      logEvent('room_ready', { players, space: scan.report?.spaceSize, reportFailed: Boolean(scan.error) })
      setScreen('choose-game')
    }
  }, [screen, scan, players])

  function onPhotoFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) shrinkPhoto(file).then(small => onScan({ frames: [small] }))
  }

  // Ask how many are playing right away; the room gets checked behind that question.
  function onScan({ frames, views, labels = {} }) {
    logEvent('scan_submitted', { photos: frames.length, labels: Object.keys(labels).join(', ') })
    setError(null)
    setScan(null)
    // Show exactly the frames the AI analyzes, so the outlines line up with them.
    frameUrls.forEach(u => URL.revokeObjectURL(u))
    setFrameUrls(frames.map(f => URL.createObjectURL(f)))
    setSpotted(labels)
    setScreen('count')
    startScan(frames, views).then(first => {
      setScan(first)
      logEvent('scan_result', { verdict: first.location?.verdict, peopleSeen: first.peopleSeen })
    }).catch(err => {
      setError(err.message)
      setScreen('error')
    })
  }

  const snap = () => setScreen('scan')
  const upload = () => fileInput.current?.click()

  return (
    <div className="app">
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={onPhotoFile} />

      {screen === 'home' && (
        <main className="home">
          <h1>Room Rush</h1>
          <p className="tagline">Party gone flat? Scan the room. We'll turn it into a game show.</p>
          {canResume && <button className="secondary" onClick={() => setScreen('clap-catch')}>▶ Resume your game</button>}
          <section className="card consent">
            <h2>Before you play</h2>
            <ul>
              <li><span>🎥</span><p><strong>We film the room and the players.</strong> Make sure everyone on camera is OK with it.</p></li>
              <li><span>🛟</span><p><strong>Play safe.</strong> Clear the floor, use soft things only, and stay away from lamps, TVs and anything breakable. Stop if anyone feels unsafe.</p></li>
              <li><span>🤖</span><p><strong>Meta AI reads your photos and clips</strong> to set up the game and referee it.{' '}
                {RECORDING ? <>This is a test version: we save video and sound of each game, and review them using AI tools, to improve Room Rush.</> : "Room Rush doesn't save them."}</p></li>
            </ul>
          </section>
          <button className="primary big" onClick={async () => { askMotionPermission(); prepareVoice(); await askCameraAndMic(); snap() }}>Got it, let's play!</button>
        </main>
      )}

      {screen === 'scan' && (
        <Camera
          title="Scan your room"
          hint="Stand in the middle of the room, where you'll play. Tap Start, then turn slowly to the right when told. We'll scan all the way around, then the ceiling."
          onCapture={onScan}
          onBack={() => setScreen('home')}
          onUpload={upload}
        />
      )}

      {screen !== 'home' && screen !== 'scan' && screen !== 'clap-catch' && (
        <header className="topbar">
          <button className="link" onClick={() => setScreen('home')}>Room Rush</button>
          <button className="link" onClick={snap}>New scan</button>
        </header>
      )}

      {screen === 'count' && (
        <main>
          <section className="card">
            <h2>How many players?</h2>
            {scan?.peopleNotes?.length > 0 && <p className="note">Heads up: {scan.peopleNotes.join(' ')} Maybe leave them out?</p>}
            <Stepper label="Players" value={players} min={1} max={8} onChange={setPlayers} />
            {players === 1 && <p className="note">Clap Catch is more fun with friends, but you can practice alone.</p>}
            <button className="primary" onClick={() => setScreen('room-check')}>Let's play</button>
          </section>
          <Spotted labels={spotted} />
          <Frames urls={frameUrls} report={scan?.report} />
        </main>
      )}

      {screen === 'room-check' && (
        <main>
          <Status text="Checking the room is safe to play in…" />
          <Spotted labels={spotted} />
          <Frames urls={frameUrls} report={scan?.report} />
        </main>
      )}

      {screen === 'unsafe' && (
        <main>
          <section className="card verdict move">
            <h2>⛔ Not safe here</h2>
            <p>{scan.location.reason}</p>
            <p className="meta">{scan.location.suggestion || 'Please move somewhere safer, then scan again.'}</p>
          </section>
          <button className="primary" onClick={snap}>📷 Scan a different spot</button>
          <Frames urls={frameUrls} />
        </main>
      )}

      {screen === 'too-small' && (
        <main>
          <section className="card verdict move">
            <h2>⛔ Not enough room here</h2>
            <p>Throwing a ball needs some open space. Clear the floor, move somewhere bigger, then scan again.</p>
          </section>
          <button className="primary" onClick={snap}>📷 Scan again</button>
          <Frames urls={frameUrls} report={scan.report} />
        </main>
      )}

      {screen === 'choose-game' && (
        <main>
          <h2>Pick a game</h2>
          <button className="card game" onClick={() => { logEvent('game_chosen', { game: 'clap' }); setGameType('clap'); setScreen('clap-catch') }}>
            <h3>👏 Clap Catch</h3>
            <p>Throw it up, clap as many times as you can, catch it.</p>
          </button>
          <button className="card game" onClick={() => { logEvent('game_chosen', { game: 'scavenger' }); setGameType('scavenger'); setScreen('clap-catch') }}>
            <h3>🔎 Room Scavenger</h3>
            <p>Clues written from what the AI just found in this room. Find it fast.</p>
          </button>
        </main>
      )}

      {screen === 'clap-catch' && (
        <ClapCatch players={players} gameType={gameType} scanId={scan?.id} warnings={scan?.report?.beforeYouPlay ?? []} onBack={() => setScreen(scan ? 'choose-game' : 'home')}>
          {scan?.report && (
            <details className="card">
              <summary>What the AI saw{frameUrls.length > 1 ? ` (${frameUrls.length} frames)` : ''}</summary>
              <Frames urls={frameUrls} report={scan.report} />
              <p className="meta">{scan.report.scene}</p>
            </details>
          )}
        </ClapCatch>
      )}

      {screen === 'error' && (
        <main>
          <section className="card warn"><h2>Something went wrong</h2><p>{error}</p></section>
          <button className="primary" onClick={snap}>📷 Try again</button>
        </main>
      )}
    </div>
  )
}

// The scan's frames, one at a time, with thumbnails to switch between them.
function Frames({ urls, report }) {
  const [index, setIndex] = useState(0)
  const [hidden, setHidden] = useState({})
  const i = Math.min(index, urls.length - 1)
  if (!urls.length) return null
  return (
    <div className="frames">
      <Photo url={urls[i]} report={report} frame={i} hidden={hidden} setHidden={setHidden} />
      {urls.length > 1 && (
        <div className="thumbs">
          {urls.map((u, n) => (
            <button key={u} className={n === i ? 'on' : ''} onClick={() => setIndex(n)} aria-label={`Frame ${n + 1}`}>
              <img src={u} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Photo({ url, report, frame, hidden, setHidden }) {
  const [size, setSize] = useState(null)
  if (!url) return null
  return (
    <div className="photo-wrap">
      <div className="photo">
        <img src={url} alt="Your space" onLoad={e => setSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })} />
        {report && size && (
          <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
            {LAYERS.filter(l => !hidden[l.key]).map(layer =>
              (layer.key === 'people' ? [{ name: 'person', boxes: report.people }] : report[layer.key]).flatMap(item =>
                (item.boxes[frame] ?? []).map((b, i) => (
                  <g key={`${layer.key}-${item.name}-${i}`} className={layer.className}>
                    <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} />
                    {i === 0 && <Label box={b} text={shortLabel(item.name)} imageWidth={size.w} />}
                  </g>
                ))))}
          </svg>
        )}
      </div>
      {report && (
        <div className="legend">
          {LAYERS.map(l => (
            <button key={l.key} className={`chip ${l.className} ${hidden[l.key] ? 'off' : ''}`}
              onClick={() => setHidden(h => ({ ...h, [l.key]: !h[l.key] }))}>
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// A solid pill behind each label so it stays readable on busy photos. Sized relative to the photo.
function Label({ box, text, imageWidth }) {
  const font = Math.round(imageWidth / 30)
  const pad = Math.round(font * 0.3)
  const width = Math.round(text.length * font * 0.58) + pad * 2
  const x = Math.min(box.x1, imageWidth - width)
  const y = Math.max(box.y1 - font - pad * 2, 0)
  return (
    <g className="label">
      <rect x={x} y={y} width={width} height={font + pad * 2} rx={pad} />
      <text x={x + pad} y={y + font + pad * 0.4} fontSize={font}>{text}</text>
    </g>
  )
}

// "Fragile decorations and candle holders on mantel" → "Fragile decorations…"
const shortLabel = name => (name.length > 22 ? `${name.slice(0, 20).trimEnd()}…` : name)

function Stepper({ label, value, min, max, onChange }) {
  return (
    <div className="stepper">
      <span>{label}</span>
      <button onClick={() => onChange(Math.max(min, value - 1))} aria-label={`Fewer ${label}`}>−</button>
      <strong>{value}</strong>
      <button onClick={() => onChange(Math.min(max, value + 1))} aria-label={`More ${label}`}>+</button>
    </div>
  )
}

// Labels SAM spotted during the sweep, shown while the full report is built.
function Spotted({ labels }) {
  const list = Object.entries(labels)
  if (!list.length) return null
  return (
    <div className="spotted static">
      {list.map(([label, l]) => <span key={label} className={`spot ${l.hazard ? 'hazard' : ''}`}>{label}{l.count > 1 ? ` ×${l.count}` : ''}</span>)}
    </div>
  )
}

function Status({ text }) {
  return <p className="status"><span className="spinner" /> {text}</p>
}

