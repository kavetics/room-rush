import { useEffect, useRef, useState } from 'react'

// "What the AI saw" for a Clap Catch turn: live while it's analyzed, then a replay of the video.

const box = (b, className) => b && <rect className={className} x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} />

/** While the referee works: each frame as SAM looks at it, then each step as it finishes. */
export function LiveAnalysis({ frames, progress }) {
  const [urls, setUrls] = useState([])
  const [size, setSize] = useState(null)
  useEffect(() => {
    const list = frames.map(f => URL.createObjectURL(f.blob))
    setUrls(list)
    return () => list.forEach(u => URL.revokeObjectURL(u))
  }, [frames])

  const latest = progress.frames.at(-1)
  return (
    <section className="card ai-live">
      <h2>🔍 What the AI sees</h2>
      {latest && urls[latest.index] && (
        <div className="photo">
          <img src={urls[latest.index]} alt={`Frame at ${latest.t}s`} onLoad={e => setSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })} />
          {size && <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">{box(latest.ball, 'box-ball')}</svg>}
        </div>
      )}
      <ul className="ai-steps">
        <Step done={progress.measured} active={!progress.measured}>
          SAM 3.1 finding the ball: frame {progress.frames.length} of {frames.length}, ball in {progress.frames.filter(f => f.ball).length}
        </Step>
        {progress.measured && (
          <Step done>
            {progress.measured.thrownAt != null ? `Code found the throw at ${progress.measured.thrownAt}s, highest at ${progress.measured.peakAt}s` : 'Code did not find a clear throw'}
          </Step>
        )}
        {progress.spark && <Step done={progress.call} active={!progress.call}>Muse Spark reviewing {progress.spark.frames} frames</Step>}
        {progress.call && <Step done>Muse Spark: {progress.call.reason}</Step>}
      </ul>
    </section>
  )
}

function Step({ done, active, children }) {
  return <li className={done ? 'done' : ''}>{done ? '✓' : active ? <span className="spinner small" /> : '…'} {children}</li>
}

/** Afterwards: the video with the ball outlined and each event appearing when it happens. */
export function TurnReplay({ clipUrl, frames, call, envelope }) {
  const video = useRef(null)
  const [time, setTime] = useState(0)
  const [size, setSize] = useState(null)
  const { track = [], thrownAt, peakAt, sparkTimes = [] } = call.report ?? {}
  const length = track.at(-1)?.t || 1

  useEffect(() => {
    let live = true
    createImageBitmap(frames[0].blob).then(b => { if (live) setSize({ w: b.width, h: b.height }) }).catch(() => {})
    return () => { live = false }
  }, [frames])

  // Follow the video closely so the outline stays on the ball.
  useEffect(() => {
    let raf
    const tick = () => {
      if (video.current) setTime(video.current.currentTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const events = [
    thrownAt != null && { t: thrownAt, label: '🚀 Throw' },
    ...(call.claps?.counted ?? []).map((t, i) => ({ t, label: `👏 ${i + 1}` })),
    call.caughtAt != null && { t: call.caughtAt, label: '🙌 Catch' },
    call.call === 'dropped' && peakAt != null && { t: Math.min(length, peakAt + 1), label: '❌ Dropped' },
  ].filter(Boolean).sort((a, b) => a.t - b.t)

  const nearest = track.reduce((best, f) => (!best || Math.abs(f.t - time) < Math.abs(best.t - time) ? f : best), null)
  const trail = track.filter(f => f.ball && f.t <= time && f.t > time - 1)
  const center = b => `${(b.x1 + b.x2) / 2},${(b.y1 + b.y2) / 2}`
  const seek = t => { if (video.current) video.current.currentTime = t }

  return (
    <section className="card">
      <h2>🔍 What the AI saw</h2>
      <div className="replay" style={size ? { aspectRatio: `${size.w} / ${size.h}` } : undefined}>
        <video ref={video} src={clipUrl} controls playsInline autoPlay muted loop />
        {size && (
          <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
            {nearest && box(nearest.person, 'box-person')}
            {trail.length > 1 && <polyline className="ball-trail" points={trail.map(f => center(f.ball)).join(' ')} />}
            {nearest && box(nearest.ball, 'box-ball')}
          </svg>
        )}
        <div className="replay-events">
          {events.filter(e => e.t <= time).slice(-4).map(e => <span key={`${e.label}${e.t}`} className="spot">{e.label}</span>)}
        </div>
      </div>

      <div className="timeline" aria-label="Timeline of the turn">
        <div className="playhead" style={{ left: `${Math.min(100, (time / length) * 100)}%` }} />
        {sparkTimes.map(t => <span key={t} className="tick spark" style={{ left: `${(t / length) * 100}%` }} />)}
        {events.map(e => <button key={`${e.label}${e.t}`} className="mark" style={{ left: `${Math.min(100, (e.t / length) * 100)}%` }} onClick={() => seek(e.t)} aria-label={`Jump to ${e.label}`}>{e.label.split(' ')[0]}</button>)}
      </div>
      {envelope?.length > 0 && <AudioMap envelope={envelope} heard={call.claps?.heard ?? []} counted={call.claps?.counted ?? []} time={time} onSeek={seek} />}
      <p className="meta">Yellow: the ball, as SAM 3.1 found it · White: the player · Purple ticks: frames Muse Spark reviewed. Tap a marker to jump there.</p>

      <ul className="ai-steps">
        <li className="done">✓ SAM 3.1 looked {call.timing.samCalls} times in {(call.timing.samMs / 1000).toFixed(1)}s · ball in {call.evidence.framesWithBall} frames</li>
        {call.claps && <li className="done">✓ Plain code heard {call.claps.heard.length} sharp sounds, counted {call.claps.count ?? 0} between throw and catch</li>}
        {call.timing.framesSentToSpark > 0 && <li className="done">✓ Muse Spark reviewed {call.timing.framesSentToSpark} frames in {(call.timing.sparkMs / 1000).toFixed(1)}s (confidence {Math.round(call.confidence * 100)}%)</li>}
      </ul>
      <details>
        <summary>The raw numbers</summary>
        <pre className="evidence">{JSON.stringify({ ...call.evidence, claps: call.claps }, null, 2)}</pre>
      </details>
    </section>
  )
}

// The clip's sound, loudest moments tallest. Green: spikes counted as claps. Grey: spikes heard but
// not counted (before the throw, after the catch, or the ball landing). Tap to jump there.
function AudioMap({ envelope, heard, counted, time, onSeek }) {
  const width = 300
  const height = 60
  const length = envelope.length / 100 // one value per 10 ms
  const step = Math.max(1, Math.floor(envelope.length / width))
  const bars = []
  for (let i = 0; i < envelope.length; i += step) bars.push(Math.max(...envelope.slice(i, i + step)))
  const peak = Math.max(0.01, ...bars)
  const x = t => (t / length) * width
  const countedSet = new Set(counted)
  return (
    <div className="audio-map">
      <p className="meta">🔊 What the mic heard: {heard.length} sharp {heard.length === 1 ? 'sound' : 'sounds'}, {counted.length} counted</p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect()
          onSeek(((e.clientX - r.left) / r.width) * length)
        }}
      >
        {bars.map((v, i) => {
          const h = Math.max(1, (v / peak) * (height - 8))
          return <rect key={i} className="wave" x={(i / bars.length) * width} y={height - h} width={Math.max(0.6, width / bars.length - 0.2)} height={h} />
        })}
        {heard.map(t => <line key={t} className={countedSet.has(t) ? 'spike counted' : 'spike'} x1={x(t)} x2={x(t)} y1={0} y2={height} />)}
        <line className="audio-playhead" x1={x(Math.min(time, length))} x2={x(Math.min(time, length))} y1={0} y2={height} />
      </svg>
      <p className="meta meter-axis"><span>0s</span><span>{length.toFixed(1)}s</span></p>
      <p className="meta"><span className="key still">counted as a clap</span> <span className="key before">heard, not counted</span></p>
    </div>
  )
}
