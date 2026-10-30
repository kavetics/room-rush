import { useEffect, useRef, useState } from 'react'
import { refereeCatch } from './api.js'
import { LiveAnalysis, TurnReplay } from './AiSaw.jsx'
import { loudnessEnvelope, sampleFrames, startRecording, useCamera } from './useCamera.js'

const TURN = { soloSeconds: 10, minSeconds: 2, maxSeconds: 15 }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const CALLS = {
  caught: { icon: '✅', title: 'Caught it!', className: 'go' },
  dropped: { icon: '❌', title: 'Dropped', className: 'move' },
  unclear: { icon: '🤔', title: "Couldn't tell", className: 'caution' },
}

const LIMITS = { minPlayers: 1, maxPlayers: 8, roundChoices: [1, 3, 5] }

// Most total claps with clean catches wins; ties are shown as ties.
function standings(names, results) {
  const rows = names.map((name, index) => {
    const turns = results.filter(r => r.player === index)
    return {
      index,
      name,
      claps: turns.reduce((sum, t) => sum + (t.score ?? 0), 0),
      catches: turns.filter(t => t.call === 'caught').length,
      turns: turns.length,
    }
  })
  return rows.sort((a, b) => b.claps - a.claps || b.catches - a.catches)
}

// Setup first, so the camera only starts once the game does.
export default function ClapCatch({ players, onBack }) {
  const [game, setGame] = useState(null)
  if (!game) return <GameSetup suggested={players} onStart={setGame} onBack={onBack} />
  return <ClapCatchGame key={game.id} names={game.names} rounds={game.rounds} onBack={onBack} onPlayAgain={() => setGame({ ...game, id: game.id + 1 })} />
}

function GameSetup({ suggested, onStart, onBack }) {
  const [count, setCount] = useState(Math.min(LIMITS.maxPlayers, Math.max(LIMITS.minPlayers, suggested || 2)))
  const [names, setNames] = useState([])
  const [rounds, setRounds] = useState(3)
  const finalNames = Array.from({ length: count }, (_, i) => names[i]?.trim() || `Player ${i + 1}`)
  return (
    <main>
      <button className="link" onClick={onBack}>← Back</button>
      <section className="card">
        <h2>👏 Clap Catch</h2>
        <p>Throw the ball up, clap as many times as you can, catch it. Claps only count with a clean catch. Most claps after all the rounds wins.</p>
        <p className="meta">Use a soft ball, and keep clear of lamps, ceiling fans, TVs and anything breakable. Keep it quiet during a turn so the mic hears the claps.</p>
      </section>
      <section className="card">
        <div className="stepper">
          <span>Players</span>
          <button onClick={() => setCount(c => Math.max(LIMITS.minPlayers, c - 1))} aria-label="Fewer players">−</button>
          <strong>{count}</strong>
          <button onClick={() => setCount(c => Math.min(LIMITS.maxPlayers, c + 1))} aria-label="More players">+</button>
        </div>
        <div className="name-list">
          {Array.from({ length: count }, (_, i) => (
            <input
              key={i}
              value={names[i] ?? ''}
              placeholder={`Player ${i + 1}`}
              maxLength={16}
              aria-label={`Name of player ${i + 1}`}
              onChange={e => setNames(list => { const next = [...list]; next[i] = e.target.value; return next })}
            />
          ))}
        </div>
        <p className="meta">Rounds</p>
        <div className="round-choice">
          {LIMITS.roundChoices.map(n => <button key={n} className={rounds === n ? 'on' : ''} onClick={() => setRounds(n)}>{n}</button>)}
        </div>
        <p className="meta">{count * rounds} turns, about {Math.max(1, Math.round(count * rounds * 0.75))} minutes.</p>
      </section>
      <button className="primary big" onClick={() => onStart({ id: 1, names: finalNames, rounds })}>Start game</button>
    </main>
  )
}

function ClapCatchGame({ names, rounds, onBack, onPlayAgain }) {
  const total = names.length
  const [player, setPlayer] = useState(0)
  const [round, setRound] = useState(0)
  const [results, setResults] = useState([])
  const [mode, setMode] = useState('hold') // hold: someone films (back camera); solo: phone propped up (front camera, so you can see yourself)
  const { video, stream, status, error, stop, retry } = useCamera({ audio: true, facing: mode === 'solo' ? 'user' : 'environment' })
  const [stage, setStage] = useState('ready') // ready → countdown → recording → review → judging → result → (standings between rounds); done
  const [countdown, setCountdown] = useState(null)
  const [seconds, setSeconds] = useState(0)
  const [tip, setTip] = useState(null)
  const [clip, setClip] = useState(null) // { url, frames }
  const [call, setCall] = useState(null)
  const [failure, setFailure] = useState(null)
  const [progress, setProgress] = useState(null) // what the referee has done so far
  const take = useRef(null)

  useEffect(() => () => {
    clearInterval(take.current?.clock)
    clearTimeout(take.current?.limit)
  }, [])

  function beginRecording(limitSeconds) {
    setTip(null)
    const started = performance.now()
    take.current = {
      started,
      recorder: startRecording(stream.current),
      sampler: sampleFrames(video.current),
      clock: setInterval(() => setSeconds((performance.now() - started) / 1000), 200),
      limit: setTimeout(endRecording, limitSeconds * 1000),
    }
    setSeconds(0)
    setStage('recording')
  }

  async function endRecording() {
    const t = take.current
    if (!t || t.ending) return
    t.ending = true
    clearInterval(t.clock)
    clearTimeout(t.limit)
    const length = (performance.now() - t.started) / 1000
    const [blob, frames] = await Promise.all([t.recorder.stop(), t.sampler.stop()])
    take.current = null
    if (length < TURN.minSeconds) {
      setTip('Too short. Keep recording until the ball is back down.')
      setStage('ready')
      return
    }
    setClip({ url: URL.createObjectURL(blob), frames, blob })
    setStage('review')
  }

  async function startSolo() {
    setStage('countdown')
    for (const n of [3, 2, 1]) {
      setCountdown(n)
      await wait(1000) // on screen only: speech and an open microphone conflict on iPhone
    }
    setCountdown(null)
    beginRecording(TURN.soloSeconds)
  }

  async function submit() {
    setStage('judging')
    setFailure(null)
    setProgress({ frames: [] })
    const onProgress = event => setProgress(p => {
      if (event.step === 'frame') return { ...p, frames: [...p.frames, event] }
      return { ...p, [event.step]: event }
    })
    try {
      const envelope = await loudnessEnvelope(clip.blob)
      setClip(c => ({ ...c, envelope }))
      setCall(await refereeCatch(clip.frames, envelope, onProgress))
      setStage('result')
    } catch (err) {
      setFailure(err.message)
      setStage('review')
    }
  }

  function redo() {
    if (clip) URL.revokeObjectURL(clip.url)
    setClip(null)
    setCall(null)
    setStage('ready')
  }

  function nextTurn() {
    // Keep this turn's clip for the end-of-game report. One frame is enough there (for the size); the rest would fill the phone's memory.
    const kept = { url: clip.url, frames: clip.frames.slice(0, 1), envelope: clip.envelope }
    setResults(r => [...r, { player, round, call: call.call, reason: call.reason, score: call.call === 'caught' ? (call.score ?? 0) : 0, clip: kept, details: call }])
    setClip(null)
    setCall(null)
    if (player + 1 < total) {
      setPlayer(player + 1)
      setStage('ready')
    } else if (round + 1 < rounds) {
      setStage('standings')
    } else {
      stop()
      setStage('done')
    }
  }

  function nextRound() {
    setPlayer(0)
    setRound(round + 1)
    setStage('ready')
  }

  if (stage === 'done') {
    const table = standings(names, results)
    const best = table[0]
    const winners = table.filter(t => t.claps === best.claps && t.catches === best.catches)
    const anyCatch = table.some(t => t.catches > 0)
    return (
      <main>
        <section className="card">
          <h2>🏆 {anyCatch ? `${winners.map(w => w.name).join(' & ')} ${winners.length > 1 ? 'tie' : 'wins'}!` : 'No clean catches'}</h2>
          <Standings table={table} rounds={rounds} />
        </section>
        <section className="card">
          <h3>Every turn</h3>
          {Array.from({ length: rounds }, (_, n) => (
            <div key={n}>
              {rounds > 1 && <p className="meta">Round {n + 1}</p>}
              {results.filter(r => r.round === n).map(r => (
                <details key={`${r.round}-${r.player}`} className="turn-row">
                  <summary>{names[r.player]} {CALLS[r.call].icon} {r.call === 'caught' ? `${r.score} ${r.score === 1 ? 'clap' : 'claps'}` : CALLS[r.call].title}</summary>
                  <p className="meta">{r.reason}</p>
                  <TurnReplay clipUrl={r.clip.url} frames={r.clip.frames} call={r.details} envelope={r.clip.envelope} />
                </details>
              ))}
            </div>
          ))}
        </section>
        <button className="primary" onClick={onPlayAgain}>↺ Play again</button>
        <button className="secondary" onClick={onBack}>Back</button>
      </main>
    )
  }

  const recording = stage === 'recording'
  const camera = ['ready', 'countdown', 'recording'].includes(stage)

  return (
    <div className="camera">
      <video ref={video} className={`camera-video ${mode === 'solo' ? 'mirrored' : ''}`} playsInline muted />
      {status === 'ready' && camera && <PersonOutline />}
      {status === 'starting' && <p className="camera-msg">Starting camera…</p>}
      {status === 'error' && <p className="camera-msg">{error}</p>}
      {countdown && <p className="camera-countdown">{countdown}</p>}

      <div className="camera-top">
        <button className="camera-icon" disabled={recording || stage === 'countdown'} onClick={() => { stop(); onBack() }} aria-label="Back">←</button>
        <span>{recording ? <><span className="rec-dot" /> {seconds.toFixed(0)}s</> : `${rounds > 1 ? `Round ${round + 1} of ${rounds} · ` : ''}${names[player]}`}</span>
        <span />
      </div>

      {status === 'error' && <div className="camera-bottom"><button className="primary" onClick={retry}>📷 Turn on camera</button></div>}
      {camera && status === 'ready' && (
        <div className="camera-bottom">
          <p className={`camera-hint ${tip ? 'tip' : ''}`}>
            {tip || (recording
              ? 'Throw, clap as many times as you can, catch!'
              : mode === 'hold'
                ? "Fit the player's whole body and the space above their head. Hold the button while they throw and catch."
                : `Prop the phone up facing you and step back. You get a countdown, then ${TURN.soloSeconds} seconds.`)}
          </p>
          {stage === 'ready' && (
            <div className="mode-switch">
              <button className={mode === 'hold' ? 'on' : ''} onClick={() => setMode('hold')}>Someone films</button>
              <button className={mode === 'solo' ? 'on' : ''} onClick={() => setMode('solo')}>Solo</button>
            </div>
          )}
          {mode === 'hold'
            ? (
              <button
                className={`shutter ${recording ? 'recording' : ''}`}
                onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); if (stage === 'ready') beginRecording(TURN.maxSeconds) }}
                onPointerUp={endRecording}
                onPointerCancel={endRecording}
                onContextMenu={e => e.preventDefault()}
              >
                {recording ? 'REC' : <>HOLD<br />+ FILM</>}
              </button>
            )
            : stage === 'ready' && <button className="shutter" onClick={startSolo}>START</button>}
        </div>
      )}

      {stage === 'review' && (
        <div className="turn-sheet">
          <video className="turn-clip" src={clip.url} controls playsInline loop autoPlay muted />
          {failure && <p className="note">{failure}</p>}
          <div className="row">
            <button className="secondary" onClick={redo}>↺ Redo</button>
            <button className="primary" onClick={submit}>✓ Submit</button>
          </div>
        </div>
      )}

      {stage === 'judging' && <div className="turn-sheet"><LiveAnalysis frames={clip.frames} progress={progress} /></div>}

      {stage === 'standings' && (
        <div className="turn-sheet">
          <section className="card">
            <h2>Round {round + 1} of {rounds} done</h2>
            <Standings table={standings(names, results)} rounds={rounds} />
          </section>
          <button className="primary big" onClick={nextRound}>Start round {round + 2}</button>
        </div>
      )}

      {stage === 'result' && call && (
        <div className="turn-sheet">
          <section className={`card verdict ${CALLS[call.call].className}`}>
            <h2>{CALLS[call.call].icon} {CALLS[call.call].title}{call.call === 'caught' && call.claps ? ` ${call.claps.count ?? '?'} ${call.claps.count === 1 ? 'clap' : 'claps'}` : ''}</h2>
            <p>{call.reason}</p>
            {call.closeCall && <span className="tag">close call</span>}
          </section>
          <TurnReplay clipUrl={clip.url} frames={clip.frames} call={call} envelope={clip.envelope} />
          <div className="row">
            <button className="secondary" onClick={redo}>↺ Redo turn</button>
            <button className="primary" onClick={nextTurn}>{player + 1 < total ? `${names[player + 1]} is next →` : round + 1 < rounds ? 'Scoreboard →' : '🏁 Final results'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Standings({ table, rounds }) {
  return (
    <ol className="standings">
      {table.map((row, i) => (
        <li key={row.index}>
          <span className="rank">{i + 1}</span>
          <strong>{row.name}</strong>
          <span className="meta">{row.catches} of {row.turns} caught</span>
          <span className="total">{row.claps} {row.claps === 1 ? 'clap' : 'claps'}</span>
        </li>
      ))}
      {rounds > 1 && <li className="standings-note meta">Only claps with a clean catch count.</li>}
    </ol>
  )
}

// Where to stand: a dashed body outline, like the sketch.
function PersonOutline() {
  return (
    <svg className="person-outline" viewBox="0 0 100 200" aria-hidden="true">
      <circle cx="50" cy="42" r="13" />
      <path d="M50 55 V125 M50 72 L26 100 M50 72 L74 100 M50 125 L32 180 M50 125 L68 180" />
    </svg>
  )
}
