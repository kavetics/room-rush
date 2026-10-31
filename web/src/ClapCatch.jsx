import { useEffect, useRef, useState } from 'react'
import { isConnectionError, judgeFind, refereeCatch, scavengerClues } from './api.js'
import { LiveAnalysis, TurnReplay } from './AiSaw.jsx'
import { askCameraAndMic, loudnessEnvelope, openMic, report, sampleFrames, startRecordingWithMic, useCamera } from './useCamera.js'
import { logEvent, RECORDING, saveTurn } from './session.js'
import { playClip, prepareVoice } from './voice.js'
import { clearSavedGame, dropTurnMedia, loadSavedGame, saveGameState, saveTurnMedia } from './savedGame.js'

const TURN = { minSeconds: 2, maxSeconds: 15, refereeAttempts: 4, handsFreePauseMs: 1500, afterTimeMs: 800, resultsPauseMs: 1200 }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const CALLS = {
  caught: { icon: '✅', title: 'Caught it!', className: 'go' },
  found: { icon: '✅', title: 'Found it!', className: 'go' },
  missed: { icon: '❌', title: 'Not this time', className: 'move' },
  dropped: { icon: '❌', title: 'Dropped', className: 'move' },
  unclear: { icon: '🤔', title: "Couldn't tell", className: 'caution' },
}

// What differs between games. The camera, turns, queue, results and resume are shared.
const GAMES = {
  clap: {
    title: '👏 Clap Catch',
    about: 'Throw the ball up, clap as many times as you can, catch it. Claps only count with a clean catch. Most claps after all the rounds wins.',
    safety: 'Use a soft ball, and keep clear of lamps, ceiling fans, TVs and anything breakable. Keep it quiet during a turn so the mic hears the claps.',
    seconds: 6, fps: 4, sound: true, success: 'caught', unit: ['clap', 'claps'], doneWord: 'caught', rules: 'rules',
    ready: 'Wait for Go, then throw, clap, catch!', doing: 'Tap Done once the ball is caught.', frame: 'Fit their whole body and the space above their head, then tap Start.',
  },
  scavenger: {
    title: '🔎 Room Scavenger',
    about: 'The AI writes clues from what it found in your room. Read your clue, wait for Go, find it and show it to the camera. Faster finds score more.',
    safety: "Walk, don't run. Only pick up small, soft things that are safe to carry. Stay out of other people's belongings unless they say it's OK.",
    seconds: 20, fps: 2, sound: false, success: 'found', unit: ['point', 'points'], doneWord: 'found', rules: 'scav-rules',
    ready: 'Read the clue out loud, then tap Start.', doing: 'Follow them if you can. Tap Done once they show it.', frame: 'Read the clue out loud, then tap Start.',
  },
}

// Seated play: same games, nobody gets up. The coordinator picks this for less mobile players.
const SEATED = {
  clap: {
    about: 'Stay seated. Toss a balloon up, clap as many times as you can, catch it. Claps only count with a clean catch. Most claps after all the rounds wins.',
    safety: 'Use a balloon, and check for latex allergies. Everyone stays seated, and a helper fetches any balloon that drifts away.',
    seconds: 8, rules: 'rules-seated', ready: 'Stay seated. Wait for Go, then toss, clap, catch!', doing: 'Tap Done once the balloon is caught.', frame: 'Fit them and the space above their head, then tap Start.',
  },
  scavenger: {
    about: 'Stay seated. The AI writes a clue, and you show the camera something you are wearing or can reach. Faster finds score more.',
    safety: "Everyone stays seated. Keep it to things you're happy to show, and skip anything private.",
    seconds: 15, rules: 'scav-rules-seated', ready: 'Read the clue out loud, then tap Start.', doing: 'Tap Done once they show it.', frame: 'Read the clue out loud, then tap Start.',
  },
}
const gameDef = (type, seated) => ({ ...GAMES[type], ...(seated ? SEATED[type] : {}) })

const LIMITS = { minPlayers: 1, maxPlayers: 8, roundChoices: [1, 3, 5] }

// Most total claps with clean catches wins; ties are shown as ties.
function standings(names, results) {
  const rows = names.map((name, index) => {
    const turns = results.filter(r => r.player === index)
    return {
      index,
      name,
      claps: turns.reduce((sum, t) => sum + (t.score ?? 0), 0),
      catches: turns.filter(t => t.success).length,
      turns: turns.length,
    }
  })
  return rows.sort((a, b) => b.claps - a.claps || b.catches - a.catches)
}

// Setup first, so the camera only starts once the game does. A saved game can be picked up again.
export default function ClapCatch({ players, warnings, children, onBack, gameType = 'clap', scanId }) {
  const [game, setGame] = useState(null)
  const [saved, setSaved] = useState(undefined)
  useEffect(() => { loadSavedGame().then(g => setSaved(g ?? null)).catch(() => setSaved(null)) }, [])

  if (game) {
    return <ClapCatchGame key={game.id} gameNumber={game.id} names={game.names} rounds={game.rounds} startMode={game.mode} saved={game.saved} def={gameDef(game.gameType ?? gameType, game.seated)} seated={game.seated} clues={game.clues} onBack={onBack}
      onPlayAgain={() => { prepareVoice(); logEvent('play_again'); clearSavedGame(); setGame({ ...game, id: game.id + 1, saved: null }) }} />
  }
  async function resume() {
    prepareVoice()
    await askCameraAndMic()
    logEvent('game_resumed', { round: saved.round, player: saved.player, turns: saved.jobs.length })
    setGame({ id: saved.gameNumber, names: saved.names, rounds: saved.rounds, mode: saved.mode, gameType: saved.gameType, seated: saved.seated, clues: saved.clues, saved })
  }
  async function startFresh() {
    await clearSavedGame()
    setSaved(null)
  }
  return (
    <>
      {saved && (
        <main className="resume">
          <section className="card warn">
            <h2>Resume your game?</h2>
            <p>{saved.names.join(', ')} · {saved.stage === 'done' ? 'finished' : `round ${saved.round + 1} of ${saved.rounds}, ${saved.names[saved.player]}'s turn`}</p>
            <div className="row">
              <button className="secondary" onClick={startFresh}>New game</button>
              <button className="primary" onClick={resume}>{saved.stage === 'done' ? 'See the results' : 'Resume'}</button>
            </div>
          </section>
        </main>
      )}
      {saved === null && <GameSetup suggested={players} warnings={warnings} extras={children} onStart={setGame} onBack={onBack} gameType={gameType} scanId={scanId} />}
    </>
  )
}

function GameSetup({ suggested, warnings = [], extras, onStart, onBack, gameType, scanId }) {
  const [seated, setSeated] = useState(false)
  const def = gameDef(gameType, seated)
  const [failure, setFailure] = useState(null)
  const [testedVoice, setTestedVoice] = useState(false)
  const [mode, setMode] = useState('film') // film: someone films (back camera); solo: phone propped up (front camera)
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
    logEvent('game_started', { game: gameType, seated, players: count, rounds, names: finalNames.join(', '), micAllowed })
    await clearSavedGame()
    let clues = null
    if (gameType === 'scavenger') {
      try {
        ;({ clues } = await scavengerClues(scanId, count * rounds, seated))
      } catch (err) {
        report(`clues failed: ${err.message}`)
        setFailure("Couldn't get the clues. Check the connection and try again.")
        setStarting(false)
        return
      }
    }
    onStart({ id: 1, names: finalNames, rounds, mode, gameType, seated, clues, micAllowed })
  }

  return (
    <main>
      <button className="link" onClick={onBack}>← Back</button>
      {warnings.length > 0 && (
        <section className="card warn">
          <h2>Before you play</h2>
          <ul>{warnings.map(t => <li key={t}>{t}</li>)}</ul>
        </section>
      )}
      <section className="card">
        <h2>{def.title}</h2>
        <p>{def.about}</p>
        {RECORDING && <p className="note">Test version: video and sound of this game are saved, and reviewed using AI tools, to improve Room Rush. Make sure everyone on camera is OK with that.</p>}
        <p className="meta">{def.safety}</p>
      </section>
      <section className="card">
        <div className="stepper">
          <span>Players</span>
          <button onClick={() => setCount(c => Math.max(LIMITS.minPlayers, c - 1))} aria-label="Fewer players">−</button>
          <strong>{count}</strong>
          <button onClick={() => setCount(c => Math.min(LIMITS.maxPlayers, c + 1))} aria-label="More players">+</button>
        </div>
        {count === 1 && <p className="note">Clap Catch is more fun with friends, but you can practice alone.</p>}
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
        <p className="meta">How are people playing?</p>
        <div className="round-choice">
          <button className={!seated ? 'on' : ''} onClick={() => setSeated(false)}>{gameType === 'scavenger' ? 'Walking' : 'Standing'}</button>
          <button className={seated ? 'on' : ''} onClick={() => setSeated(true)}>Seated</button>
        </div>
        {!seated && <p className="meta">Only for steady, active players. If in doubt, choose Seated.</p>}
        <p className="meta">Filming</p>
        <div className="round-choice">
          <button className={mode === 'film' ? 'on' : ''} onClick={() => setMode('film')}>Someone films</button>
          <button className={mode === 'solo' ? 'on' : ''} onClick={() => setMode('solo')}>Solo</button>
        </div>
        <p className="meta">Rounds</p>
        <div className="round-choice">
          {LIMITS.roundChoices.map(n => <button key={n} className={rounds === n ? 'on' : ''} onClick={() => setRounds(n)}>{n}</button>)}
        </div>
        <p className="meta">{count * rounds} turns, about {Math.max(1, Math.round(count * rounds * 0.4))} minutes.</p>
      </section>
      <button className="secondary" onClick={() => { prepareVoice(); playClip('hear'); setTestedVoice(true) }}>🔊 Test the voice</button>
      {testedVoice && <p className="meta">Should say "Can you hear me?" If not, turn the volume up and turn off the silent switch.</p>}
      {extras}
      {failure && <p className="note">{failure}</p>}
      <button className="primary big" disabled={starting} onClick={begin}>{starting ? (gameType === 'scavenger' ? 'Writing your clues…' : 'Allow the microphone…') : 'Start game'}</button>
    </main>
  )
}

// Turns run back to back: the referee works through a queue in the background, and the results
// come together after the last turn of the round, so nobody waits between turns.
function ClapCatchGame({ gameNumber, names, rounds, startMode, saved, def, seated, clues, onBack, onPlayAgain }) {
  const total = names.length
  const [player, setPlayer] = useState(saved?.player ?? 0)
  const [round, setRound] = useState(saved?.round ?? 0)
  const [jobs, setJobs] = useState(saved?.jobs ?? []) // one per recorded turn: { id, round, player, status, clip, call, failure }
  const [retake, setRetake] = useState(saved?.retake ?? false) // re-recording one turn from the results screen
  const mode = startMode // film: someone films (back camera); solo: phone propped up (front camera)
  const { video, stream, status, error, stop, retry } = useCamera({ facing: mode === 'solo' ? 'user' : 'environment' })
  const [stage, setStage] = useState(saved?.stage ?? 'ready') // ready → countdown → recording → (next turn) … → results → standings; done
  const [countdown, setCountdown] = useState(null)
  const [seconds, setSeconds] = useState(0)
  const [tip, setTip] = useState(null)
  const [progress, setProgress] = useState(null) // what the referee is doing on the turn being checked
  const [checking, setChecking] = useState(null) // that turn's id
  const [handsFree, setHandsFree] = useState(false) // after the first solo turn, turns run by themselves
  const [turnToken, setTurnToken] = useState(0)
  const take = useRef(null)
  const announced = useRef(null)
  const rulesSpoken = useRef(false)
  const queue = useRef(Promise.resolve())
  const nextId = useRef(saved?.nextId ?? 1)
  const tries = useRef(saved?.tries ?? {}) // attempts per turn, for the saved recordings

  // Pick up any turns that weren't checked before the reload.
  useEffect(() => {
    saved?.jobs.filter(j => j.status === 'judging' && !j.replaced).forEach(job => {
      queue.current = queue.current.then(() => judge(job))
    })
    if (saved?.stage === 'results') playClip('getting-results')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Save progress on every change. A turn in progress isn't saved: that player goes again.
  useEffect(() => {
    saveGameState({
      gameNumber, names, rounds, round, player, mode, retake, clues, seated, gameType: clues ? 'scavenger' : 'clap',
      stage: ['countdown', 'recording'].includes(stage) ? 'ready' : stage,
      nextId: nextId.current,
      tries: tries.current,
      jobs: jobs.map(({ clip: _clip, cancelled: _cancelled, ...job }) => job),
    })
  }, [jobs, round, player, stage, mode, retake]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (stage === 'done') stop() }, [stage]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    clearInterval(take.current?.clock)
    clearTimeout(take.current?.limit)
  }, [])

  // Keep the screen on while the phone sits propped up.
  useEffect(() => {
    const lock = navigator.wakeLock?.request('screen').catch(() => null)
    return () => { lock?.then(l => l?.release?.().catch(() => {})) }
  }, [])

  const clueFor = (r, p, extra = 0) => clues?.[(r * total + p + extra) % clues.length]
  const updateJob = (id, fields) => setJobs(list => list.map(j => (j.id === id ? { ...j, ...fields } : j)))
  const active = jobs.filter(j => !j.replaced)
  const finished = active.filter(j => j.status !== 'judging')
  const needsRetake = job => job.status === 'failed' || job.call?.call === 'unclear' || (def.sound && job.call?.call === 'caught' && job.call.claps?.count == null)
  const results = finished.map(j => ({
    player: j.player,
    round: j.round,
    call: j.call?.call ?? 'unclear',
    reason: j.call?.reason ?? j.failure,
    success: j.call?.call === def.success,
    score: j.call?.call === def.success ? (j.call.score ?? 0) : 0,
    jobId: j.id,
    var: j.var,
    clip: j.clip,
    details: j.call,
  }))

  // New game: explain the one rule that matters, so nobody throws before Go.
  useEffect(() => {
    if (status === 'ready' && !saved && !rulesSpoken.current) {
      rulesSpoken.current = true
      playClip(def.rules)
    }
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Each later turn gets announced. In Solo it then starts by itself, because nobody is at the phone.
  useEffect(() => {
    if (stage !== 'ready' || status !== 'ready' || !jobs.length) return
    const key = `${round}-${player}-${turnToken}`
    if (announced.current === key) return
    announced.current = key
    let live = true
    wait(TURN.afterTimeMs).then(() => (live ? playClip('next-player') : null)).then(async () => {
      if (!live || !handsFree) return
      await wait(TURN.handsFreePauseMs)
      if (live) startTurn()
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

  function beginRecording(mic) {
    setTip(null)
    const t = {}
    take.current = t
    setSeconds(0)
    setStage('recording')
    const recorder = startRecordingWithMic(stream.current, mic)
    logEvent('recording_started', { round, player, mode, sound: Boolean(mic) })
    const started = performance.now()
    Object.assign(t, {
      started,
      recorder,
      sampler: sampleFrames(video.current, { fps: def.fps }),
      clock: setInterval(() => setSeconds((performance.now() - started) / 1000), 200),
      limit: setTimeout(endRecording, def.seconds * 1000),
    })
  }

  async function endRecording() {
    const t = take.current
    if (!t || t.ending) return
    t.ending = true
    clearInterval(t.clock)
    clearTimeout(t.limit)
    const length = (performance.now() - t.started) / 1000
    logEvent('recording_ended', { round, player, seconds: Math.round(length * 10) / 10 })
    const [blob, frames] = await Promise.all([t.recorder.stop(), t.sampler.stop()])
    take.current = null
    if (length < TURN.minSeconds) {
      setTip('Too short. Keep filming until the ball is back in their hands.')
      setStage('ready')
      return
    }
    const job = { id: nextId.current++, round, player, status: 'judging', clip: { url: URL.createObjectURL(blob), frames, blob } }
    saveTurnMedia(job.id, job.clip)
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

  // Everyone gets the same signal to start: 3-2-1 at exactly one per second, whatever the voice does.
  async function startTurn() {
    if (mode === 'solo') setHandsFree(true)
    announced.current = `${round}-${player}-${turnToken}`
    setStage('countdown')
    logEvent('countdown', { round, player })
    setCountdown('ready')
    // The mic takes about a second and disturbs sound playing at that moment, so open it in the quiet
    // before the countdown. People throw right after "1": any gap there and the throw isn't recorded.
    const mic = def.sound ? await openMic() : null
    for (const n of [3, 2, 1]) {
      setCountdown(n)
      playClip(`n${n}`)
      await wait(1000)
    }
    setCountdown(null)
    playClip('go')
    beginRecording(mic)
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
    const envelope = def.sound ? (job.clip.envelope ?? await loudnessEnvelope(job.clip.blob)) : null
    job.clip.envelope = envelope
    const save = (call, failure) => saveTurn({ game: gameNumber, round: job.round, player: job.player, name: names[job.player], attempt: attemptNumber, clip: job.clip, call, failure })
    // A dropped connection shouldn't cost anyone their turn: the frames are still here, so send them again.
    for (let attempt = 1; ; attempt++) {
      setProgress({ frames: [] })
      try {
        const result = clues
          ? await judgeFind(job.clip.frames, clueFor(job.round, job.player, job.clueNumber), def.seconds)
          : await refereeCatch(job.clip.frames, envelope, onProgress)
        report(`turn judged: ${result.call}${result.item ? ` · item ${result.item} · score ${result.score}` : ''} · claps ${result.claps?.count ?? '?'} · ball in ${result.evidence.framesWithBall} · throw at ${result.evidence.thrownAt} · ${result.timing.totalMs} ms · ${result.reason}`)
        save(result)
        logEvent('verdict', { round: job.round, player: job.player, call: result.call, claps: result.claps?.count ?? null, ms: result.timing.totalMs })
        updateJob(job.id, { status: 'done', call: result })
        break
      } catch (err) {
        report(`referee attempt ${attempt} failed: ${err.name} ${err.message}`)
        // Errors from the server won't change by retrying; a dropped connection might.
        if (!isConnectionError(err) || attempt >= TURN.refereeAttempts) {
          const failure = isConnectionError(err) ? "Couldn't reach the referee. Check the Wi-Fi." : `The referee couldn't run. ${err.message}`
          save(null, err.message)
          updateJob(job.id, { status: 'failed', failure })
          break
        }
        await wait(1000 * attempt)
      }
    }
    setChecking(null)
  }

  // VAR: a player disagrees, so look again more closely. SAM follows the ball through every frame,
  // Muse Spark thinks harder with that as evidence, and the new call replaces the old one.
  async function requestVar(jobId) {
    const job = jobs.find(j => j.id === jobId)
    if (!job?.clip.frames.length) return
    logEvent('var_requested', { round: job.round, player: job.player, was: job.call?.call, claps: job.call?.claps?.count ?? null })
    updateJob(jobId, { var: { state: 'running' } })
    try {
      const again = await refereeCatch(job.clip.frames, job.clip.envelope, () => {}, { review: true })
      const before = job.call
      const changed = again.call !== before?.call || again.score !== before?.score
      logEvent('var_decided', { changed, call: again.call, claps: again.claps?.count ?? null, ms: again.timing.totalMs })
      updateJob(jobId, { call: again, var: { state: 'done', changed, was: before } })
    } catch (err) {
      report(`VAR failed: ${err.name} ${err.message}`)
      updateJob(jobId, { var: { state: 'failed' } })
    }
  }

  function retryJudging(job) {
    updateJob(job.id, { status: 'judging', failure: null })
    queue.current = queue.current.then(() => judge(job))
  }

  // Record one turn again. Its old take no longer counts.
  function retakeTurn(job) {
    logEvent('retake', { round: job.round, player: job.player })
    job.cancelled = true
    dropTurnMedia(job.id)
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
    dropTurnMedia(last.id)
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
          <h2>🏆 {anyCatch ? `${winners.map(w => w.name).join(' & ')} ${winners.length > 1 ? 'tie' : 'wins'}!` : (clues ? 'Nothing found this time' : 'No clean catches')}</h2>
          <Standings table={table} rounds={rounds} def={def} />
        </section>
        <section className="card">
          <h3>Every turn</h3>
          {Array.from({ length: rounds }, (_, n) => (
            <div key={n}>
              {rounds > 1 && <p className="meta">Round {n + 1}</p>}
              {results.filter(r => r.round === n).map(r => (
                <details key={`${r.round}-${r.player}`} className="turn-row">
                  <summary>{names[r.player]} {CALLS[r.call].icon} {r.success ? `${r.score} ${def.unit[r.score === 1 ? 0 : 1]}` : CALLS[r.call].title}</summary>
                  <p className="meta">{r.reason}</p>
                  {clues && <p className="meta">Clue: {clueFor(r.round, r.player)?.clue}{r.details?.item ? ` · Showed: ${r.details.item}` : ''}</p>}
                  {clues && r.clip.url && <video className="turn-clip" src={r.clip.url} controls playsInline muted />}
                  {!clues && <VarPanel info={r.var} canReview={r.clip.frames?.length > 1} onRequest={() => requestVar(r.jobId)} />}
                  {!clues && r.details && r.clip.url && <TurnReplay clipUrl={r.clip.url} frames={r.clip.frames} call={r.details} envelope={r.clip.envelope} />}
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
      {status === 'ready' && camera && (stage !== 'ready' || handsFree || clues) && (
        <div className={`turn-card ${recording ? 'go' : 'read'}`}>
          {stage === 'ready' && <p className="turn-title">{names[player]}, get ready</p>}
          {stage === 'countdown' && <p className={`turn-title ${countdown === 'ready' ? '' : 'big'}`}>{countdown === 'ready' ? `${names[player]}, get ready` : countdown ?? 'GO!'}</p>}
          {recording && <p className="turn-title big">GO!</p>}
          {clues
            ? <p className="turn-sub">{clueFor(round, player)?.clue}</p>
            : stage !== 'recording' && <p className="turn-sub">{def.ready}</p>}
          {recording && (
            <>
              <p className="turn-left">{Math.max(0, Math.ceil(def.seconds - seconds))}s</p>
              <div className="turn-bar"><div style={{ width: `${Math.max(0, 1 - seconds / def.seconds) * 100}%` }} /></div>
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
              ? (mode === 'film' ? def.doing : '')
              : stage === 'countdown' ? 'Wait for Go!'
              : mode === 'film'
                ? `${names[player]}'s turn. ${def.frame}`
                : handsFree ? 'Starting by itself…' : 'Prop the phone up facing you, step back, then tap Start.')}
          </p>
          {stage === 'ready' && lastJob && !retake && (
            <button className="secondary-dark" onClick={redoLast}>↺ Redo {names[lastJob.player]}'s turn</button>
          )}
          {stage === 'ready' && !handsFree && <button className="shutter" onClick={startTurn}>START</button>}
          {recording && mode === 'film' && <button className="shutter recording" onClick={endRecording}>DONE</button>}
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
          {!clues && checkingJob && progress && <LiveAnalysis frames={checkingJob.clip.frames} progress={progress} />}
          {!stillChecking && roundJobs.some(needsRetake) && <button className="secondary" onClick={() => { logEvent('kept_results', { round }); finishRound() }}>Keep these results (those turns score 0)</button>}
        </div>
      )}

      {stage === 'standings' && (
        <div className="turn-sheet">
          <section className="card">
            <h2>Round {round + 1} of {rounds} done</h2>
            <Standings table={standings(names, results)} rounds={rounds} def={def} />
          </section>
          <button className="primary big" onClick={nextRound}>Start round {round + 2}</button>
        </div>
      )}
    </div>
  )
}

// Disagree with the call? Ask for a closer look, like video review in sports.
function VarPanel({ info, canReview, onRequest }) {
  if (info?.state === 'running') return <p className="status"><span className="spinner small" /> VAR is taking a closer look…</p>
  if (info?.state === 'done') {
    if (!info.changed) return <p className="note">🎥 VAR: the call stands.</p>
    const was = info.was
    return <p className="note">🎥 VAR changed the call. It was {was?.call === 'caught' ? `caught, ${was.score ?? 0} claps` : was ? CALLS[was.call].title.toLowerCase() : 'unknown'}.</p>
  }
  if (!canReview) return null
  return (
    <>
      {info?.state === 'failed' && <p className="note">VAR couldn't run. Check the connection and try again.</p>}
      <button className="secondary var-button" onClick={onRequest}>🎥 Disagree? Request VAR</button>
    </>
  )
}

function Standings({ table, rounds, def }) {
  return (
    <ol className="standings">
      {table.map((row, i) => (
        <li key={row.index}>
          <span className="rank">{i + 1}</span>
          <strong>{row.name}</strong>
          <span className="meta">{row.catches} of {row.turns} {def.doneWord}</span>
          <span className="total">{row.claps} {def.unit[row.claps === 1 ? 0 : 1]}</span>
        </li>
      ))}
      {rounds > 1 && def.sound && <li className="standings-note meta">Only claps with a clean catch count.</li>}
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
