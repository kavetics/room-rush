import { useEffect, useRef, useState } from 'react'
import { startScan, getScan, answerPlayers, getGame, shrinkPhoto } from './api.js'
import './App.css'

const VERDICT = {
  go: { label: 'Good to go', icon: '✅' },
  caution: { label: 'OK, with care', icon: '⚠️' },
  move: { label: 'Not safe here', icon: '⛔' },
}

const LAYERS = [
  { key: 'people', label: 'People', className: 'people' },
  { key: 'props', label: 'Props', className: 'prop' },
  { key: 'fixtures', label: 'Fixtures', className: 'fixture' },
  { key: 'hazards', label: 'Hazards', className: 'hazard' },
]

export default function App() {
  const [screen, setScreen] = useState('home')
  const [photoUrl, setPhotoUrl] = useState(null)
  const [scan, setScan] = useState(null)
  const [players, setPlayers] = useState(4)
  const [seated, setSeated] = useState(0)
  const [result, setResult] = useState(null)
  const [game, setGame] = useState(null)
  const [error, setError] = useState(null)
  const [clock, setClock] = useState({ start: 0, answeredAt: 0 })
  const fileInput = useRef(null)

  // While the host counts heads, keep checking on the background report and games.
  useEffect(() => {
    if (!scan?.id || screen !== 'count' || scan.gamesReady || scan.error) return
    const timer = setInterval(() => getScan(scan.id).then(setScan).catch(() => {}), 1200)
    return () => clearInterval(timer)
  }, [scan?.id, scan?.gamesReady, scan?.error, screen])

  async function onPhoto(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    setResult(null)
    setGame(null)
    setScreen('checking')
    setClock({ start: Date.now(), answeredAt: 0 })
    try {
      // Show exactly the image the AI analyzes, so the outlines line up with it.
      const small = await shrinkPhoto(file)
      setPhotoUrl(URL.createObjectURL(small))
      const first = await startScan(small)
      setScan(first)
      setPlayers(Math.max(first.peopleSeen + 1, 2))
      setSeated(0)
      setScreen(first.status === 'unsafe' ? 'unsafe' : 'count')
    } catch (err) {
      setError(err.message)
      setScreen('error')
    }
  }

  async function onAnswer() {
    setScreen('loading-games')
    setClock(c => ({ ...c, answeredAt: Date.now() }))
    try {
      setResult(await answerPlayers(scan.id, players, seated))
      setScreen('games')
    } catch (err) {
      setError(err.message)
      setScreen('error')
    }
  }

  async function openGame(card, index) {
    setGame({ ...card, rounds: null, waitedMs: null })
    try {
      const { game: full, waitedMs } = await getGame(scan.id, index)
      setGame({ ...full, waitedMs })
    } catch (err) {
      setGame(g => ({ ...g, error: err.message }))
    }
  }

  const snap = () => fileInput.current?.click()

  return (
    <div className="app">
      <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />

      {screen === 'home' && (
        <main className="home">
          <h1>Room Rush</h1>
          <p className="tagline">Party gone flat? Snap the room. We'll turn it into a game show.</p>
          <button className="primary big" onClick={snap}>📸 Snap the room</button>
          <p className="meta">Use the normal 1× lens (not 0.5×) and step back to fit the whole space.</p>
        </main>
      )}

      {screen !== 'home' && (
        <header className="topbar">
          <button className="link" onClick={() => setScreen('home')}>Room Rush</button>
          <button className="link" onClick={snap}>New photo</button>
        </header>
      )}

      {screen === 'checking' && (
        <main>
          <Photo url={photoUrl} />
          <Status text="Checking if this is a safe place to play…" />
        </main>
      )}

      {screen === 'unsafe' && (
        <main>
          <Photo url={photoUrl} />
          <Verdict location={scan.location} />
          <button className="primary" onClick={snap}>📸 Try another spot</button>
        </main>
      )}

      {screen === 'count' && (
        <main>
          <Photo url={photoUrl} report={scan.report} />
          <Verdict location={scan.location} />
          <section className="card">
            <h2>{scan.question}</h2>
            {scan.peopleNotes?.length > 0 && <p className="note">Heads up: {scan.peopleNotes.join(' ')} Maybe leave them out?</p>}
            <Stepper label="Playing" value={players} min={1} max={25} onChange={setPlayers} />
            <Stepper label="Seated or referee" value={seated} min={0} max={Math.max(players - 1, 0)} onChange={setSeated} />
            <button className="primary" onClick={onAnswer}>Let's play</button>
          </section>
          <Progress scan={scan} />
        </main>
      )}

      {screen === 'loading-games' && (
        <main>
          <Photo url={photoUrl} report={scan.report} />
          <Status text="Finishing your games…" />
          <Progress scan={scan} />
        </main>
      )}

      {screen === 'games' && result && !game && (
        <main>
          <Timing clock={clock} waitedMs={result.waitedMs} />
          {result.beforeYouPlay.length > 0 && (
            <section className="card warn">
              <h2>Before you play</h2>
              <ul>{result.beforeYouPlay.map(t => <li key={t}>{t}</li>)}</ul>
            </section>
          )}
          {[
            { kind: 'classic', title: '🎯 Classics', blurb: 'Proven party games, set up for your room.' },
            { kind: 'experiment', title: '🧪 AI Experiments', blurb: 'Invented by AI just now for this room. Untested, and the referee may be less reliable. Why not try something new?' },
          ].map(section => {
            const games = result.games.map((g, index) => ({ g, index })).filter(({ g }) => g.kind === section.kind)
            if (!games.length) return null
            return (
              <section key={section.kind} className="game-section">
                <h2 className="section-title">{section.title}</h2>
                <p className="meta">{section.blurb}</p>
                {games.map(({ g, index }) => (
                  <button key={g.title} className={`card game ${g.kind}`} onClick={() => openGame(g, index)}>
                    {g.kind === 'experiment' && <span className="tag">AI-invented · untested</span>}
                    <h3>{g.title}</h3>
                    <p>{g.pitch}</p>
                    <p className="meta">{g.min_players}–{g.max_players} players · {g.space_needed} space{g.seated_role ? ' · seated role' : ''}</p>
                  </button>
                ))}
              </section>
            )
          })}
          <details className="card">
            <summary>What the AI saw</summary>
            <Photo url={photoUrl} report={scan.report} />
            <p className="meta">{scan.report?.scene}</p>
          </details>
        </main>
      )}

      {screen === 'games' && game && (
        <main>
          <button className="link" onClick={() => setGame(null)}>← All games</button>
          <section className="card">
            {game.kind === 'experiment' && <span className="tag">AI-invented · untested</span>}
            <h2>{game.title}</h2>
            <p>{game.pitch}</p>
            {game.setup && <p><strong>Setup:</strong> {game.setup}</p>}
            <p className="meta">Roles: {game.roles.join(', ')}{game.seated_role ? ` · Seated: ${game.seated_role}` : ''}</p>
            <p className="meta">Uses: {game.uses.join(', ')}</p>
          </section>
          {!game.rounds && !game.error && <Status text="Writing the rounds…" />}
          {game.error && <p className="note">{game.error}</p>}
          {game.waitedMs != null && <p className="timing">Waited {(game.waitedMs / 1000).toFixed(1)}s for rounds</p>}
          {game.rounds?.map((r, i) => (
            <section key={i} className="card">
              <h3>Round {i + 1} · {r.seconds}s</h3>
              <p>{r.instruction}</p>
              <p className="meta">🎥 Record the {r.seconds}s round{r.referee.look_for ? `: ${r.referee.look_for}` : ''}</p>
              <p className="meta">🧑‍⚖️ {r.referee.rule}</p>
            </section>
          ))}
        </main>
      )}

      {screen === 'error' && (
        <main>
          <section className="card warn"><h2>Something went wrong</h2><p>{error}</p></section>
          <button className="primary" onClick={snap}>📸 Try again</button>
        </main>
      )}
    </div>
  )
}

function Photo({ url, report }) {
  const [size, setSize] = useState(null)
  const [hidden, setHidden] = useState({})
  if (!url) return null
  return (
    <div className="photo-wrap">
      <div className="photo">
        <img src={url} alt="Your space" onLoad={e => setSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })} />
        {report && size && (
          <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
            {LAYERS.filter(l => !hidden[l.key]).map(layer =>
              (layer.key === 'people' ? [{ name: 'person', boxes: report.people }] : report[layer.key]).flatMap(item =>
                item.boxes.map((b, i) => (
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

function Verdict({ location }) {
  const v = VERDICT[location.verdict]
  return (
    <section className={`card verdict ${location.verdict}`}>
      <h2>{v.icon} {v.label}</h2>
      <p>{location.reason}</p>
      {location.suggestion && <p className="meta">{location.suggestion}</p>}
    </section>
  )
}

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

function Progress({ scan }) {
  const steps = [
    ['Safety check', true],
    ['Reading the room', scan.reportReady],
    ['Designing games', scan.gamesReady],
  ]
  return (
    <ul className="progress">
      {steps.map(([label, done]) => <li key={label} className={done ? 'done' : ''}>{done ? '✓' : '…'} {label}</li>)}
      {scan.error && <li className="failed">✗ {scan.error}</li>}
    </ul>
  )
}

function Status({ text }) {
  return <p className="status"><span className="spinner" /> {text}</p>
}

// Shown on purpose while we tune speed: how long everything took, and how long you waited.
function Timing({ clock, waitedMs }) {
  const total = ((clock.answeredAt - clock.start) / 1000).toFixed(1)
  return <p className="timing">You answered after {total}s · waited {(waitedMs / 1000).toFixed(1)}s for games</p>
}
