import { useEffect, useRef, useState } from 'react'
import { isConnectionError, refereeCatch, saveTestTrial } from './api.js'
import { playClip, prepareVoice } from './voice.js'
import { askCameraAndMic, loudnessEnvelope, openMic, report, sampleFrames, startRecordingWithMic, useCamera } from './useCamera.js'

// Hands-free accuracy tests. Every turn has the same rhythm: read the task, 3-2-1, GO with a visible
// timer, the referee checks it, see the result, get the ball, next. Each turn is saved with its label.
// ?test=catch: no microphone. ?test=claps: microphone on, expected clap counts.
const TURN_SECONDS = 6
const READ_MS = 3000
const RESULT_MS = 2500
const FETCH_MS = 4000

const CATCH_PLAN = [
  ...Array(6).fill({ label: 'caught', style: 'normal', task: 'Catch it', clip: 'catch' }),
  ...Array(2).fill({ label: 'caught', style: 'one hand', task: 'Catch with one hand', clip: 'catch-one' }),
  ...Array(2).fill({ label: 'caught', style: 'against chest', task: 'Catch against your chest', clip: 'catch-chest' }),
  ...Array(6).fill({ label: 'dropped', style: 'normal', task: 'Let it drop', clip: 'drop' }),
  ...Array(4).fill({ label: 'dropped', style: 'pick up', task: 'Drop it, then pick it up', clip: 'drop-pick' }),
]
const CLAP_PLAN = [
  ...[1, 2, 3].flatMap(n => Array(3).fill({ label: 'caught', style: 'claps', claps: n, task: `${n} ${n === 1 ? 'clap' : 'claps'}, then catch`, clip: `clap-${n}` })),
  ...Array(2).fill({ label: 'caught', style: 'clap after catch', claps: 1, task: '1 clap, catch, clap again', clip: 'clap-after' }),
  ...Array(2).fill({ label: 'dropped', style: 'claps then drop', claps: 2, task: '2 claps, then let it drop', clip: 'clap-drop' }),
]
const HIGH_PLAN = [
  ...Array(6).fill({ label: 'caught', style: 'high', task: 'Throw it HIGH and catch it', clip: 'high-catch' }),
  ...Array(4).fill({ label: 'dropped', style: 'high', task: 'Throw it HIGH, let it drop', clip: 'high-drop' }),
]
const CALL_TEXT = { caught: 'caught', dropped: 'dropped', unclear: "couldn't tell" }

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const shuffled = list => list.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v)

// A phone that drops off Wi-Fi shouldn't cost a turn or hang the test.
async function withRetries(send, what) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send()
    } catch (err) {
      report(`${what} attempt ${attempt} failed: ${err.name} ${err.message}`)
      if (!isConnectionError(err) || attempt >= 3) throw err
      await wait(1000 * attempt)
    }
  }
}

export default function CatchTest({ claps = false, high = false }) {
  // Front camera by default: the screen faces the player, so they can read the task and see the shot.
  const [facing, setFacing] = useState('user')
  const { video, stream, status, error, retry } = useCamera({ facing })
  const [stage, setStage] = useState('ready') // ready → running → done
  const [turn, setTurn] = useState(null) // { index, total, task, phase, count, call, right, note }
  const [tally, setTally] = useState({ done: 0, right: 0, failed: 0 })
  const [paused, setPaused] = useState(false)
  const [failure, setFailure] = useState(null)
  const [camera, setCamera] = useState('')
  const control = useRef({ stopping: false, paused: false })
  const lock = useRef(null)

  useEffect(() => {
    const c = control.current
    return () => {
      c.stopping = true
      lock.current?.release?.().catch(() => {})
    }
  }, [])

  // Live status, so a black screen says what's wrong.
  useEffect(() => {
    const timer = setInterval(() => {
      const v = video.current
      const track = stream.current?.getVideoTracks()[0]
      setCamera(`camera ${v?.videoWidth ?? 0}×${v?.videoHeight ?? 0} · ${track ? `${track.readyState}${track.muted ? ' muted' : ''}` : 'no track'} · ${v?.paused ? 'paused' : 'playing'}`)
    }, 500)
    return () => clearInterval(timer)
  }, [video, stream])

  function start() {
    report('START tapped')
    prepareVoice() // must start right inside the tap, or later clips are blocked
    if (claps) askCameraAndMic()
    video.current?.play().catch(() => {})
    run().catch(err => {
      report(`test failed: ${err.name} ${err.message}`)
      setFailure(`${err.name}: ${err.message}`)
      setStage('ready')
    })
  }

  async function playTurn(trial, index, total, runId, totals) {
    const base = { index: index + 1, total, task: trial.task }

    // 1. The task, with time to read it and get into position.
    setTurn({ ...base, phase: 'read' })
    await Promise.all([playClip(trial.clip), wait(READ_MS)])

    // 2. Mic first, in the quiet. Then 3-2-1, and the recording starts on GO, with no gap.
    const mic = claps ? await openMic() : null
    for (const n of [3, 2, 1]) {
      setTurn({ ...base, phase: 'count', count: n })
      await Promise.all([playClip(`n${n}`), wait(1000)])
    }
    playClip('go')
    if (control.current.stopping) return

    // 3. GO: a visible timer for the turn.
    setTurn({ ...base, phase: 'go', endsAt: performance.now() + TURN_SECONDS * 1000 })
    const recorder = claps ? startRecordingWithMic(stream.current, mic) : null
    const sampler = sampleFrames(video.current)
    await wait(TURN_SECONDS * 1000)
    const [frames, sound] = await Promise.all([sampler.stop(), recorder?.stop()])
    report(`turn ${index + 1}: ${frames.length} frames`)
    playClip('stop')

    // 4. The referee checks it (this is also a natural pause).
    setTurn({ ...base, phase: 'check' })
    const envelope = sound ? await loudnessEnvelope(sound) : null
    const [call] = await Promise.all([
      withRetries(() => refereeCatch(frames, envelope), 'referee').catch(() => null),
      withRetries(() => saveTestTrial(runId, String(index + 1).padStart(2, '0'), trial, frames, envelope), 'save').catch(() => { totals.failed++ }),
    ])

    // 5. The result, then time to get the ball.
    const callRight = call?.call === trial.label
    const clapsRight = !claps || trial.label !== 'caught' || call?.claps?.count === trial.claps
    const right = callRight && clapsRight
    totals.done++
    if (right) totals.right++
    setTally({ ...totals })
    const clapNote = claps && trial.label === 'caught' ? ` · counted ${call?.claps?.count ?? '?'} of ${trial.claps} claps` : ''
    setTurn({ ...base, phase: 'result', right, note: call ? `Referee: ${CALL_TEXT[call.call]}${clapNote}` : "Couldn't reach the referee" })
    await Promise.all([playClip(right ? 'right' : 'wrong'), wait(RESULT_MS)])
    setTurn({ ...base, phase: 'fetch', endsAt: performance.now() + FETCH_MS })
    playClip('get-ball')
    await wait(FETCH_MS)
  }

  async function run() {
    setStage('running')
    setFailure(null)
    control.current = { stopping: false, paused: false }
    // Keep the screen on while the phone sits propped up.
    lock.current = await navigator.wakeLock?.request('screen').catch(() => null)
    const runId = new Date().toISOString().replace(/[:.]/g, '-')
    const trials = shuffled(high ? HIGH_PLAN : claps ? CLAP_PLAN : CATCH_PLAN)
    const totals = { done: 0, right: 0, failed: 0 }

    setTurn({ index: 0, total: trials.length, task: 'Step back: whole body in the shot', phase: 'read' })
    await Promise.all([playClip('start'), wait(6000)])

    for (const [i, trial] of trials.entries()) {
      while (control.current.paused && !control.current.stopping) await wait(200)
      if (control.current.stopping) break
      await playTurn(trial, i, trials.length, runId, totals)
    }
    playClip('finished')
    lock.current?.release?.().catch(() => {})
    setStage('done')
  }

  const togglePause = () => {
    control.current.paused = !control.current.paused
    setPaused(control.current.paused)
  }

  return (
    <div className="camera">
      <video ref={video} className={`camera-video ${facing === 'user' ? 'mirrored' : ''}`} playsInline muted />
      {status === 'error' && <p className="camera-msg">{error}</p>}

      <div className="camera-top">
        <span />
        <span>{high ? 'High throw' : claps ? 'Clap' : 'Catch'} test{turn?.index ? ` · turn ${turn.index} of ${turn.total}` : ''}</span>
        <span />
      </div>

      {stage === 'running' && turn && <TurnCard turn={turn} tally={tally} />}

      <div className="camera-bottom">
        {status === 'error' && <button className="primary" onClick={retry}>📷 Turn on camera</button>}
        {stage === 'ready' && status === 'ready' && (
          <>
            <p className="camera-hint">Prop the phone up facing you, with your whole body and the space above your head in the shot. Each turn: read the task, 3-2-1, GO. You get {TURN_SECONDS} seconds, then the referee checks it.</p>
            <button className="secondary-dark" onClick={() => { prepareVoice(); playClip('hear') }}>🔊 Test voice</button>
            <button className="secondary-dark" onClick={() => setFacing(f => (f === 'user' ? 'environment' : 'user'))}>🔄 Use {facing === 'user' ? 'back' : 'front'} camera</button>
            <button className="shutter" onClick={start}>START</button>
          </>
        )}
        {stage === 'running' && (
          <div className="row test-controls">
            <button className="secondary-dark" onClick={togglePause}>{paused ? '▶ Resume' : '⏸ Pause after this turn'}</button>
            <button className="secondary-dark" onClick={() => { control.current.stopping = true }}>End test</button>
          </div>
        )}
        {stage === 'done' && <p className="test-final">{tally.right} of {tally.done} right. Tell Claude the test is finished.</p>}
        {failure && <p className="camera-hint tip">{failure}</p>}
        <p className="camera-status">{camera}</p>
      </div>
    </div>
  )
}

// The one thing to look at from across the room.
function TurnCard({ turn, tally }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!turn.endsAt) return undefined
    const timer = setInterval(() => tick(n => n + 1), 100)
    return () => clearInterval(timer)
  }, [turn.endsAt])
  const left = turn.endsAt ? Math.max(0, (turn.endsAt - performance.now()) / 1000) : 0

  const views = {
    read: { className: 'read', title: turn.task, sub: 'Get ready…' },
    count: { className: 'read', title: String(turn.count), sub: turn.task, big: true },
    go: { className: 'go', title: 'GO!', sub: turn.task, big: true },
    check: { className: 'check', title: 'Checking…', sub: 'The referee is looking. If Wi-Fi drops, this can take up to a minute.' },
    result: { className: turn.right ? 'right' : 'wrong', title: turn.right ? '✅ Correct' : '❌ Missed', sub: turn.note },
    fetch: { className: 'read', title: 'Get the ball', sub: 'Next turn coming up' },
  }
  const view = views[turn.phase]
  return (
    <div className={`turn-card ${view.className}`}>
      <p className={`turn-title ${view.big ? 'big' : ''}`}>{view.title}</p>
      {view.sub && <p className="turn-sub">{view.sub}</p>}
      {turn.endsAt && (
        <>
          <p className="turn-left">{Math.ceil(left)}s</p>
          <div className="turn-bar"><div style={{ width: `${(left / (turn.phase === 'go' ? TURN_SECONDS : FETCH_MS / 1000)) * 100}%` }} /></div>
        </>
      )}
      {tally.done > 0 && <p className="turn-tally">{tally.right} of {tally.done} right so far</p>}
    </div>
  )
}
