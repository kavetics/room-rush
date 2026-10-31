import { useEffect, useRef, useState } from 'react'
import { refereeCatch } from './api.js'
import { LiveAnalysis, TurnReplay } from './AiSaw.jsx'
import { askCameraAndMic, loudnessEnvelope, openMic, report, sampleFrames, startRecordingWithMic, useCamera } from './useCamera.js'
import { logEvent, RECORDING, saveTurn } from './session.js'
import { playClip, prepareVoice } from './voice.js'

const TURN = { soloSeconds: 10, minSeconds: 2, maxSeconds: 15, refereeAttempts: 3, handsFreePauseMs: 1500, afterTimeMs: 800, goMs: 600, resultsPauseMs: 1200 }
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
  return <ClapCatchGame key={game.id} gameNumber={game.id} names={game.names} rounds={game.rounds} onBack={onBack} onPlayAgain={() => { prepareVoice(); logEvent('play_again'); setGame({ ...game, id: game.id + 1 }) }} />
}

function GameSetup({ suggested, onStart, onBack }) {
  const [testedVoice, setTestedVoice] = useState(false)
  const [starting, setStarting] = useState(false)
  const [count, setCount] = useState(Math.min(LIMITS.maxPlayers, Math.max(LIMITS.minPlayers, suggested || 2)))
  const [names, setNames] = useState([])
  const [rounds, setRounds] = useState(3)
  const finalNames = Array.from({ length: count }, (_, i) => names[i]?.trim() || `Player ${i + 1}`)
  // Both need a tap: unlock the voice, and ask for the mic now while the host is at the phone.
  async function begin() {
    setStarting(true)
    prepareVoice()
    const micAllowed = await askCameraAndMic()
    logEvent('game_started', { players: count, rounds, names: finalNames.join(', '), micAllowed })
    onStart({ id: 1, names: finalNames, rounds, micAllowed })
  }

  return (
    <main>
      <button className="link" onClick={onBack}>← Back</button>
      <section className="card">
        <h2>👏 Clap Catch</h2>
        <p>Throw the ball up, clap as many times as you can, catch it. Claps only count with a clean catch. Most claps after all the rounds wins.</p>
        {RECORDING && <p className="note">Test version: video and sound of this game are saved, and reviewed using AI tools, to improve Room Rush. Make sure everyone on camera is OK with that.</p>}
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
      <button className="secondary" onClick={() => { prepareVoice(); playClip('hear'); setTestedVoice(true) }}>🔊 Test the voice</button>
      {testedVoice && <p className="meta">Should say "Can you hear me?" If not, turn the volume up and turn off the silent switch.</p>}
      <button className="primary big" disabled={starting} onClick={begin}>{starting ? 'Allow the microphone…' : 'Start game'}</button>
    </main>
  )
}

// Turns run back to back: the referee works through a queue in the background, and the results
// come together after the last turn of the round, so nobody waits between turns.
function ClapCatchGame({ gameNumber, names, rounds, onBack, onPlayAgain }) {
  const total = names.length
  const [player, setPlayer] = useState(0)
  const [round, setRound] = useState(0)
  const [jobs, setJobs] = useState([]) // one per recorded turn: { id, round, player, status, clip, call, failure }
  const [retake, setRetake] = useState(false) // re-recording one turn from the results screen
  const [mode, setMode] = useState('hold') // hold: someone films (back camera); solo: phone propped up (front camera, so you can see yourself)
  const { video, stream, status, error, stop, retry } = useCamera({ facing: mode === 'solo' ? 'user' : 'environment' })
  const [stage, setStage] = useState('ready') // ready → countdown → recording → (next turn) … → results → standings; done
  const [countdown, setCountdown] = useState(null)
  const [seconds, setSeconds] = useState(0)
  const [tip, setTip] = useState(null)
  const [progress, setProgress] = useState(null) // what the referee is doing on the turn being checked
  const [checking, setChecking] = useState(null) // that turn's id
  const [handsFree, setHandsFree] = useState(false) // after the first solo turn, turns run by themselves
  const [turnToken, setTurnToken] = useState(0)
  const take = useRef(null)
  const announced = useRef(null)
  const queue = useRef(Promise.resolve())
  const nextId = useRef(1)
  const tries = useRef({}) // attempts per turn, for the saved recordings

  useEffect(() => () => {
    clearInterval(take.current?.clock)
    clearTimeout(take.current?.limit)
  }, [])

  // Keep the screen on while the phone sits propped up.
  useEffect(() => {
    const lock = navigator.wakeLock?.request('screen').catch(() => null)
    return () => { lock?.then(l => l?.release?.().catch(() => {})) }
  }, [])

  const updateJob = (id, fields) => setJobs(list => list.map(j => (j.id === id ? { ...j, ...fields } : j)))
  const active = jobs.filter(j => !j.replaced)
  const finished = active.filter(j => j.status !== 'judging')
  const needsRetake = job => job.status === 'failed' || job.call?.call === 'unclear' || (job.call?.call === 'caught' && job.call.claps?.count == null)
  const results = finished.map(j => ({
    player: j.player,
    round: j.round,
    call: j.call?.call ?? 'unclear',
    reason: j.call?.reason ?? j.failure,
    score: j.call?.call === 'caught' ? (j.call.score ?? 0) : 0,
    clip: j.clip,
    details: j.call,
  }))

  // Hands-free: the next turn introduces itself and starts. Otherwise nothing speaks until someone starts a turn.
  useEffect(() => {
    if (stage !== 'ready' || status !== 'ready' || !handsFree) return
    const key = `${round}-${player}-${turnToken}`
    if (announced.current === key) return
    announced.current = key
    let live = true
    wait(TURN.afterTimeMs).then(() => (live ? playClip('next-player') : null)).then(async () => {
      if (!live) return
      await wait(TURN.handsFreePauseMs)
      if (live) startSolo()
    })
    return () => { live = false }
  }, [stage, status, round, player, turnToken, handsFree]) // eslint-disable-line react-hooks/exhaustive-deps

  // Everything checked: move on by itself, unless a turn needs a decision.
  useEffect(() => {
    if (stage !== 'results') return
    const inRound = active.filter(j => j.round === round)
    if (inRound.some(j => j.status === 'judging') || inRound.some(needsRetake)) return
    const timer = setTimeout(finishRound, TURN.resultsPauseMs)
    return () => clearTimeout(timer)
  }, [stage, jobs]) // eslint-disable-line react-hooks/exhaustive-deps

  async function beginRecording(limitSeconds, auto = false, openedMic) {
    setTip(null)
    const t = { pending: true, auto }
    take.current = t
    setSeconds(0)
    setStage('recording')
    if (!auto) playClip('go')
    const mic = openedMic !== undefined ? openedMic : await openMic()
    const recorder = startRecordingWithMic(stream.current, mic)
    logEvent('recording_started', { round, player, auto, sound: Boolean(mic) })
    if (t.released) { // let go of the button before the mic opened
      await recorder.stop()
      take.current = null
      setTip('Hold the button for the whole turn.')
      setStage('ready')
      return
    }
    const started = performance.now()
    Object.assign(t, {
      pending: false,
      started,
      recorder,
      sampler: sampleFrames(video.current),
      clock: setInterval(() => setSeconds((performance.now() - started) / 1000), 200),
      limit: setTimeout(endRecording, limitSeconds * 1000),
    })
  }

  async function endRecording() {
    const t = take.current
    if (!t || t.ending) return
    if (t.pending) { t.released = true; return }
    t.ending = true
    clearInterval(t.clock)
    clearTimeout(t.limit)
    const length = (performance.now() - t.started) / 1000
    logEvent('recording_ended', { round, player, seconds: Math.round(length * 10) / 10 })
    const [blob, frames] = await Promise.all([t.recorder.stop(), t.sampler.stop()])
    take.current = null
    if (length < TURN.minSeconds) {
      setTip('Too short. Keep recording until the ball is back down.')
      setStage('ready')
      return
    }
    const job = { id: nextId.current++, round, player, status: 'judging', clip: { url: URL.createObjectURL(blob), frames, blob } }
    setJobs(list => [...list, job])
    queue.current = queue.current.then(() => judge(job))
    playClip('stop')
    advance()
  }

  // Straight to the next person; the referee catches up in the background.
  function advance() {
    setTurnToken(n => n + 1)
    if (retake) {
      setRetake(false)
      setStage('results')
      playClip('getting-results')
    } else if (player + 1 < total) {
      setPlayer(player + 1)
      setStage('ready')
    } else {
      logEvent('turns_finished', { round })
      setStage('results')
      playClip('getting-results')
    }
  }

  // The first START explains the turn. Then 3-2-1 at exactly one per second, whatever the voice does.
  async function startSolo(fromTap = false) {
    setHandsFree(true)
    announced.current = `${round}-${player}-${turnToken}`
    setStage('countdown')
    logEvent('countdown', { round, player })
    setCountdown('ready')
    if (fromTap) await playClip('your-turn')
    let mic = null
    for (const n of [3, 2, 1]) {
      setCountdown(n)
      playClip(`n${n}`)
      if (n === 1) mic = openMic() // it takes about a second, so it's ready for Go
      await wait(1000)
    }
    setCountdown(null)
    // Wait for the mic before saying Go, so a slow mic can't cut off the throw.
    const openedMic = await mic
    playClip('go')
    await wait(TURN.goMs) // don't record the word "Go" as a clap
    await beginRecording(TURN.soloSeconds, true, openedMic)
  }

  async function judge(job) {
    if (job.cancelled) return
    const turn = `${job.round}-${job.player}`
    tries.current[turn] = (tries.current[turn] ?? 0) + 1
    const attemptNumber = tries.current[turn]
    logEvent('submitted', { round: job.round, player: job.player, attempt: attemptNumber, frames: job.clip.frames.length })
    setChecking(job.id)
    setProgress({ frames: [] })
    updateJob(job.id, { status: 'judging', failure: null })
    const onProgress = event => setProgress(p => {
      if (event.step === 'frame') return { ...p, frames: [...p.frames, event] }
      return { ...p, [event.step]: event }
    })
    const envelope = job.clip.envelope ?? await loudnessEnvelope(job.clip.blob)
    job.clip.envelope = envelope
    const save = (call, failure) => saveTurn({ game: gameNumber, round: job.round, player: job.player, name: names[job.player], attempt: attemptNumber, clip: job.clip, call, failure })
    // A dropped connection shouldn't cost anyone their turn: the frames are still here, so send them again.
    for (let attempt = 1; ; attempt++) {
      setProgress({ frames: [] })
      try {
        const result = await refereeCatch(job.clip.frames, envelope, onProgress)
        report(`turn judged: ${result.call} · claps ${result.claps?.count ?? '?'} · ball in ${result.evidence.framesWithBall} · throw at ${result.evidence.thrownAt} · ${result.timing.totalMs} ms · ${result.reason}`)
        save(result)
        logEvent('verdict', { round: job.round, player: job.player, call: result.call, claps: result.claps?.count ?? null, ms: result.timing.totalMs })
        updateJob(job.id, { status: 'done', call: result })
        break
      } catch (err) {
        report(`referee attempt ${attempt} failed: ${err.name} ${err.message}`)
        // TypeError means the connection failed; other errors come from the server, so retrying won't help.
        if (err.name !== 'TypeError' || attempt >= TURN.refereeAttempts) {
          const failure = err.name === 'TypeError' ? "Couldn't reach the referee. Check the Wi-Fi." : `The referee couldn't run. ${err.message}`
          save(null, err.message)
          updateJob(job.id, { status: 'failed', failure })
          break
        }
        await wait(1000 * attempt)
      }
    }
    setChecking(null)
  }

  function retryJudging(job) {
    updateJob(job.id, { status: 'judging', failure: null })
    queue.current = queue.current.then(() => judge(job))
  }

  // Record one turn again. Its old take no longer counts.
  function retakeTurn(job) {
    logEvent('retake', { round: job.round, player: job.player })
    job.cancelled = true
    updateJob(job.id, { replaced: true })
    setRetake(true)
    setPlayer(job.player)
    setTurnToken(n => n + 1)
    setStage('ready')
  }

  // Made a mistake? Redo the turn that just finished, before moving on.
  function redoLast() {
    const last = active.filter(j => j.round === round).at(-1)
    if (!last) return
    logEvent('redo', { round, player: last.player })
    last.cancelled = true
    updateJob(last.id, { replaced: true })
    setPlayer(last.player)
    setTurnToken(n => n + 1)
    announced.current = null
    setStage('ready')
  }

  function finishRound() {
    logEvent('round_over', { round })
    if (round + 1 < rounds) {
      setStage('standings')
      playClip('round-over')
    } else {
      stop()
      logEvent('game_over', { game: gameNumber })
      playClip('game-over')
      setStage('done')
    }
  }

  function nextRound() {
    setPlayer(0)
    setRound(round + 1)
    setTurnToken(n => n + 1)
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
                  {r.details && <TurnReplay clipUrl={r.clip.url} frames={r.clip.frames} call={r.details} envelope={r.clip.envelope} />}
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
  const roundJobs = active.filter(j => j.round === round)
  const stillChecking = roundJobs.filter(j => j.status === 'judging').length
  const checkingJob = roundJobs.find(j => j.id === checking)
  const lastJob = roundJobs.at(-1)

  return (
    <div className="camera">
      <video ref={video} className={`camera-video ${mode === 'solo' ? 'mirrored' : ''}`} playsInline muted />
      {status === 'ready' && camera && <PersonOutline />}
      {status === 'starting' && <p className="camera-msg">Starting camera…</p>}
      {status === 'error' && <p className="camera-msg">{error}</p>}
      {status === 'ready' && camera && (stage !== 'ready' || handsFree) && (
        <div className={`turn-card ${recording ? 'go' : 'read'}`}>
          {stage === 'ready' && <p className="turn-title">{names[player]}, get ready</p>}
          {stage === 'countdown' && <p className={`turn-title ${countdown === 'ready' ? '' : 'big'}`}>{countdown === 'ready' ? `${names[player]}, get ready` : countdown ?? 'GO!'}</p>}
          {recording && <p className="turn-title big">GO!</p>}
          <p className="turn-sub">Throw, clap as many times as you can, catch!</p>
          {recording && mode === 'solo' && (
            <>
              <p className="turn-left">{Math.max(0, Math.ceil(TURN.soloSeconds - seconds))}s</p>
              <div className="turn-bar"><div style={{ width: `${Math.max(0, 1 - seconds / TURN.soloSeconds) * 100}%` }} /></div>
            </>
          )}
        </div>
      )}

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
                ? `${names[player]}'s turn. Fit their whole body and the space above their head. Hold the button while they throw and catch.`
                : handsFree ? 'Starting by itself…' : `Prop the phone up facing you and step back. You get a countdown, then ${TURN.soloSeconds} seconds.`)}
          </p>
          {stage === 'ready' && !handsFree && (
            <div className="mode-switch">
              <button className={mode === 'hold' ? 'on' : ''} onClick={() => { setMode('hold'); setHandsFree(false) }}>Someone films</button>
              <button className={mode === 'solo' ? 'on' : ''} onClick={() => setMode('solo')}>Solo</button>
            </div>
          )}
          {stage === 'ready' && lastJob && !retake && (
            <button className="secondary-dark" onClick={redoLast}>↺ Redo {names[lastJob.player]}'s turn</button>
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
            : stage === 'ready' && !handsFree && <button className="shutter" onClick={() => startSolo(true)}>START</button>}
        </div>
      )}

      {stage === 'results' && (
        <div className="turn-sheet">
          <section className="card">
            <h2>{stillChecking ? <><span className="spinner small" /> Getting the results…</> : 'Results are in'}</h2>
            <ul className="ai-steps">
              {roundJobs.map(j => (
                <li key={j.id} className={j.status === 'judging' ? '' : 'done'}>
                  {j.status === 'judging' ? '…' : '✓'} {names[j.player]}{j.status === 'judging' ? (j.id === checking ? ': checking now' : ': waiting') : ': checked'}
                  {needsRetake(j) && j.status !== 'judging' && (
                    <div className="retake">
                      <p className="meta">{j.status === 'failed' ? j.failure : j.call.call === 'unclear' ? j.call.reason : "The claps weren't counted: the mic or the throw wasn't picked up."}</p>
                      <div className="row">
                        {j.status === 'failed' && <button className="secondary" onClick={() => retryJudging(j)}>Check again</button>}
                        <button className="primary" onClick={() => retakeTurn(j)}>↺ Retake {names[j.player]}'s turn</button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {checkingJob && progress && <LiveAnalysis frames={checkingJob.clip.frames} progress={progress} />}
          {!stillChecking && roundJobs.some(needsRetake) && <button className="secondary" onClick={() => { logEvent('kept_results', { round }); finishRound() }}>Keep these results (those turns score 0)</button>}
        </div>
      )}

      {stage === 'standings' && (
        <div className="turn-sheet">
          <section className="card">
            <h2>Round {round + 1} of {rounds} done</h2>
            <Standings table={standings(names, results)} rounds={rounds} />
          </section>
          <button className="primary big" onClick={nextRound}>Start round {round + 2}</button>
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
