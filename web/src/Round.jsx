import { useRef, useState } from 'react'
import { extractFrames, refereeRound } from './api.js'

// One round: read the instructions, record the clip, get the referee's call.
export default function Round({ scanId, game, roundIndex, onBack, onNext }) {
  const round = game.rounds[roundIndex]
  const isLast = roundIndex === game.rounds.length - 1
  const videoInput = useRef(null)
  const [stage, setStage] = useState('ready') // ready → frames → judging → result | error
  const [frames, setFrames] = useState([])
  const [call, setCall] = useState(null)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)
  const [pullInfo, setPullInfo] = useState(null)

  async function onVideo(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    setCall(null)
    try {
      setStage('frames')
      setProgress(null)
      const { frames: pulled, ms, method } = await extractFrames(file, { onProgress: (done, total) => setProgress({ done, total }) })
      setPullInfo({ ms, method })
      setFrames(pulled)
      setStage('judging')
      setCall(await refereeRound(scanId, game.index, roundIndex, pulled))
      setStage('result')
    } catch (err) {
      setError(err.message)
      setStage('error')
    }
  }

  return (
    <main>
      <input ref={videoInput} type="file" accept="video/*" capture="environment" hidden onChange={onVideo} />
      <button className="link" onClick={onBack}>← {game.title}</button>

      <section className="card">
        <p className="meta">{game.title} · Round {roundIndex + 1} of {game.rounds.length}</p>
        <h2>{round.instruction}</h2>
        <p className="meta">🎥 Record about {round.seconds}s · 🧑‍⚖️ {round.rule ?? round.referee.rule}</p>
        {round.referee.type === 'motion_after_cue' && (
          <p className="meta">Tip: prop the phone up so it stays still, and keep everyone in the frame.</p>
        )}
      </section>

      {(stage === 'ready' || stage === 'error') && (
        <button className="primary big" onClick={() => videoInput.current?.click()}>🎥 Record round</button>
      )}
      {stage === 'error' && <section className="card warn"><p>{error}</p></section>}
      {stage === 'frames' && <Status text={`Pulling frames from the clip…${progress ? ` ${progress.done} of ${progress.total}` : ''}`} />}
      {stage === 'judging' && <Status text={`The referee is reviewing ${frames.length} frames…`} />}

      {stage === 'result' && call && (
        <>
          <Verdict call={call} />
          <Evidence call={call} frames={frames} />
          {call.meter && <Meter meter={call.meter} freezeAt={call.freezeAt} />}
          {call.behind && <BehindTheScenes behind={call.behind} frames={frames} pullInfo={pullInfo} />}
          <p className="timing">Referee took {(call.totalMs / 1000).toFixed(1)}s</p>
          <div className="row">
            <button className="secondary" onClick={() => videoInput.current?.click()}>↺ Redo</button>
            {isLast
              ? <button className="primary" onClick={onBack}>🏁 Finish game</button>
              : <button className="primary" onClick={() => { setStage('ready'); setCall(null); onNext() }}>Next round →</button>}
          </div>
        </>
      )}
    </main>
  )
}

function Verdict({ call }) {
  if (call.players) {
    return (
      <section className="card verdict">
        <h2>🧑‍⚖️ The referee says…</h2>
        <p>{call.reason}</p>
        <ul className="players">
          {call.players.map(p => (
            <li key={p.label} className={p.moved ? 'out' : 'safe'}>
              <strong>{p.label}</strong> {p.moved ? `❌ moved at ${p.first_movement_seconds}s` : '✅ held still'}
              {p.closeCall && <span className="tag">close call</span>}
            </li>
          ))}
        </ul>
      </section>
    )
  }
  return (
    <section className={`card verdict ${call.verdict === 'pass' ? 'go' : 'move'}`}>
      <h2>{call.verdict === 'pass' ? '✅ Pass' : call.verdict === 'fail' ? '❌ Fail' : '🤔 Unclear'}</h2>
      <p>{call.reason}</p>
    </section>
  )
}

// The frame the call was based on, with the referee's outlines on top.
function Evidence({ call, frames }) {
  const [size, setSize] = useState(null)
  const frame = call.players ? frames.at(-1) : frames[call.lastFrameIndex ?? frames.length - 1]
  if (!frame) return null
  const boxes = call.players
    ? call.players.filter(p => p.box).map(p => ({ box: p.box, label: p.label, className: p.moved ? 'hazard' : 'prop' }))
    : Object.entries(call.boxes || {}).flatMap(([name, list]) => list.map((box, i) => ({ box, label: i === 0 ? name : '', className: 'fixture' })))
  return (
    <div className="photo">
      <img src={frame.url} alt="Referee frame" onLoad={e => setSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })} />
      {size && (
        <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
          {boxes.map((b, i) => (
            <g key={i} className={b.className}>
              <rect x={b.box.x1} y={b.box.y1} width={b.box.x2 - b.box.x1} height={b.box.y2 - b.box.y1} />
              {b.label && <text x={b.box.x1 + 8} y={b.box.y1 + size.w / 14} fontSize={size.w / 16} className="evidence-label">{b.label}</text>}
            </g>
          ))}
        </svg>
      )}
    </div>
  )
}

// How much each player's outline moved between frames, measured by SAM. The line marks the freeze.
function Meter({ meter, freezeAt }) {
  const max = Math.max(meter.stillBelow * 4, ...meter.players.flatMap(p => p.shifts))
  return (
    <section className="card">
      <h3>Movement meter</h3>
      <p className="meta">Measured by SAM 3.1 · bars under the line count as still{freezeAt != null ? ` · freeze at ${freezeAt}s` : ''}</p>
      {meter.players.map(p => (
        <div key={p.label} className="meter">
          <span>{p.label}</span>
          <div className="bars">
            {p.shifts.map((s, i) => (
              <div key={i}
                className={`bar ${meter.times[i] > (freezeAt ?? Infinity) ? (s >= meter.stillBelow ? 'moving' : 'still') : ''}`}
                style={{ height: `${Math.max(4, (s / max) * 100)}%` }}
                title={`${meter.times[i]}s: ${s}%`} />
            ))}
            <div className="threshold" style={{ bottom: `${(meter.stillBelow / max) * 100}%` }} />
          </div>
        </div>
      ))}
      <p className="meta meter-axis"><span>0s</span><span>{meter.times.at(-1)}s</span></p>
    </section>
  )
}

// Step by step: what the referee did, every frame it looked at, and the numbers behind the call.
function BehindTheScenes({ behind, frames, pullInfo }) {
  return (
    <details className="card behind">
      <summary>🔍 Behind the scenes</summary>
      <ol className="steps">
        {behind.steps.map((step, i) => (
          <li key={i}>
            {step.label}
            {step.ms != null && <span className="meta"> · {(step.ms / 1000).toFixed(1)}s</span>}
            {step.where === 'phone' && <span className="meta"> · on your phone{pullInfo ? ` · ${(pullInfo.ms / 1000).toFixed(1)}s (${pullInfo.method === 'playback' ? 'fast playback' : 'slow seeking'})` : ''}</span>}
          </li>
        ))}
      </ol>

      {behind.frames && (
        <>
          <p className="meta">Every frame, as SAM saw it. <span className="key before">before freeze</span> <span className="key still">still</span> <span className="key moving">moving</span> <span className="key ignored">ignored</span> · ⭐ = sent to Muse Spark</p>
          <div className="strip">
            {behind.frames.map((f, i) => <FrameCard key={i} frame={f} url={frames[i]?.url} />)}
          </div>
        </>
      )}

      <p className="meta">What the referee measured{behind.frames ? ' (sent to Muse Spark with the frames)' : ''}:</p>
      <pre className="evidence">{JSON.stringify(behind.evidence, null, 2)}</pre>
    </details>
  )
}

function FrameCard({ frame, url }) {
  const [size, setSize] = useState(null)
  const STILL = 6
  const colorOf = p => frame.phase === 'before' ? 'before' : p.shift >= STILL ? 'moving' : 'still'
  return (
    <figure className="frame">
      <div className="photo">
        {url && <img src={url} alt={`Frame at ${frame.t}s`} onLoad={e => setSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })} />}
        {size && (
          <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
            {frame.ignored?.map((b, i) => <rect key={`i${i}`} className="box ignored" x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} />)}
            {frame.players.map(p => <rect key={p.label} className={`box ${colorOf(p)}`} x={p.box.x1} y={p.box.y1} width={p.box.x2 - p.box.x1} height={p.box.y2 - p.box.y1} />)}
          </svg>
        )}
      </div>
      <figcaption>
        {frame.sentToSpark && '⭐ '}{frame.t}s
        {frame.players.map(p => <span key={p.label} className={colorOf(p)}> {p.label} {p.shift}%</span>)}
      </figcaption>
    </figure>
  )
}

function Status({ text }) {
  return <p className="status"><span className="spinner" /> {text}</p>
}
