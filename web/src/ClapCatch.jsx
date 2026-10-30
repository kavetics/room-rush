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

// Clap Catch, one player at a time: record the turn, review it, the AI referee rules caught or dropped,
// and plain code counts the claps from the sound. Most claps with a clean catch wins; a drop scores 0.
export default function ClapCatch({ players, onBack }) {
  const total = Math.min(4, Math.max(1, players))
  const [player, setPlayer] = useState(0)
  const [results, setResults] = useState([])
  const [mode, setMode] = useState('hold') // hold: someone films (back camera); solo: phone propped up (front camera, so you can see yourself)
  const { video, stream, status, error, stop, retry } = useCamera({ audio: true, facing: mode === 'solo' ? 'user' : 'environment' })
  const [stage, setStage] = useState('ready') // ready → countdown → recording → review → judging → result; done
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

  function nextPlayer() {
    // Keep this player's clip: the end-of-game report replays it.
    setResults(r => [...r, { player: player + 1, call: call.call, reason: call.reason, score: call.score, clip, details: call }])
    setClip(null)
    setCall(null)
    setStage('ready')
    if (player + 1 >= total) {
      stop()
      setStage('done')
    } else {
      setPlayer(player + 1)
    }
  }

  if (stage === 'done') {
    const best = Math.max(0, ...results.map(r => r.score ?? 0))
    const winners = results.filter(r => r.call === 'caught' && r.score === best)
    return (
      <main>
        <section className="card">
          <h2>🏆 {winners.length ? `${winners.map(w => `Player ${w.player}`).join(' & ')} ${winners.length > 1 ? 'tie' : 'wins'}!` : 'No clean catches'}</h2>
          <ul className="players">
            {results.map(r => <li key={r.player}><strong>Player {r.player}</strong> {CALLS[r.call].icon} {CALLS[r.call].title}{r.call === 'caught' ? ` · ${r.score ?? '?'} claps` : ''}<p className="meta">{r.reason}</p></li>)}
          </ul>
        </section>
        {results.map(r => (
          <details key={r.player} className="card">
            <summary>🔍 What the AI saw: Player {r.player}</summary>
            <TurnReplay clipUrl={r.clip.url} frames={r.clip.frames} call={r.details} envelope={r.clip.envelope} />
          </details>
        ))}
        <button className="primary" onClick={onBack}>Back to games</button>
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
        <span>{recording ? <><span className="rec-dot" /> {seconds.toFixed(0)}s</> : `Player ${player + 1} of ${total}`}</span>
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
            <button className="primary" onClick={nextPlayer}>{player + 1 >= total ? '🏁 Finish' : 'Next player →'}</button>
          </div>
        </div>
      )}
    </div>
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
