import { useRef, useState } from 'react'
import { report } from './useCamera.js'
import './session.js'

// Test page: can the iPhone speak while filming, with the mic open or closed, and which way of
// playing sound works? Results go to the Mac's log. Open the app with ?test=voice
const CLIPS = ['hear', 'n3', 'n2', 'n1', 'go', 'stop']
const LIMIT_MS = 5000
const browser = /CriOS/.test(navigator.userAgent) ? 'Chrome' : /Safari/.test(navigator.userAgent) ? 'Safari' : 'Other'

export default function VoiceTest() {
  const video = useRef(null)
  const element = useRef(null)
  const context = useRef(null)
  const buffers = useRef({})
  const urls = useRef({})
  const stream = useRef(null)
  const [ready, setReady] = useState(false)
  const [micOpen, setMicOpen] = useState(false)
  const [lines, setLines] = useState([])
  const [pendingRating, setPendingRating] = useState(null)
  const [error, setError] = useState(null)

  const say = text => {
    report(`voice test [${browser}]: ${text}`)
    setLines(l => [text, ...l].slice(0, 12))
  }
  const micState = () => (stream.current?.getAudioTracks().some(t => t.readyState === 'live') ? 'mic open' : 'mic closed')

  // Everything starts from this one tap: camera and mic permission together, and unlocking sound.
  async function start() {
    try {
      element.current = new Audio()
      element.current.play().catch(() => {})
      const Ctx = window.AudioContext || window.webkitAudioContext
      context.current = new Ctx()
      context.current.resume().catch(() => {})
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: { ideal: 'user' } } })
      stream.current = s
      setMicOpen(true)
      video.current.muted = true
      video.current.srcObject = s
      await video.current.play()
      await Promise.all(CLIPS.map(async name => {
        const blob = await (await fetch(`/voice/${name}.m4a`)).blob()
        urls.current[name] = URL.createObjectURL(blob)
        buffers.current[name] = await context.current.decodeAudioData(await blob.arrayBuffer())
      }))
      say(`ready · ${micState()} · ${video.current.videoWidth}×${video.current.videoHeight}`)
      setReady(true)
    } catch (err) {
      setError(`${err.name}: ${err.message}`)
      report(`voice test failed to start: ${err.name} ${err.message}`)
    }
  }

  // Open or close the mic while the camera keeps running.
  async function toggleMic() {
    if (micOpen) {
      stream.current.getAudioTracks().forEach(t => { t.stop(); stream.current.removeTrack(t) })
      setMicOpen(false)
      say('mic closed by tap')
      return
    }
    const asked = performance.now()
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
    mic.getAudioTracks().forEach(t => stream.current.addTrack(t))
    setMicOpen(true)
    say(`mic opened in ${Math.round(performance.now() - asked)} ms`)
  }

  function playElement(name) {
    return new Promise(resolve => {
      const a = element.current
      const asked = performance.now()
      let settled = false
      const done = text => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(text)
      }
      const timer = setTimeout(() => done(`STUCK after ${LIMIT_MS} ms (ready ${a.readyState}, network ${a.networkState}, paused ${a.paused})`), LIMIT_MS)
      a.onended = () => done(`finished in ${Math.round(performance.now() - asked)} ms`)
      a.onerror = () => done(`error ${a.error?.code}`)
      a.src = urls.current[name]
      a.play().catch(err => done(`blocked: ${err.name}`))
    })
  }

  async function playWebAudio(name) {
    const ctx = context.current
    const asked = performance.now()
    const before = ctx.state
    if (ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 1000))]).catch(() => {})
    return new Promise(resolve => {
      const source = ctx.createBufferSource()
      source.buffer = buffers.current[name]
      source.connect(ctx.destination)
      const timer = setTimeout(() => resolve(`STUCK (context ${ctx.state})`), LIMIT_MS)
      source.onended = () => { clearTimeout(timer); resolve(`finished in ${Math.round(performance.now() - asked)} ms (context ${before} → ${ctx.state})`) }
      source.start()
    })
  }

  async function run(how) {
    const play = how === 'normal' ? playElement : playWebAudio
    const situation = micState()
    setPendingRating(null)
    const result = await play('hear')
    say(`${how}, ${situation}: ${result}`)
    setPendingRating(`${how}, ${situation}`)
  }

  async function countdown(how) {
    const play = how === 'normal' ? playElement : playWebAudio
    const situation = micState()
    setPendingRating(null)
    const results = []
    for (const name of ['n3', 'n2', 'n1', 'go']) {
      const started = performance.now()
      const result = await play(name)
      results.push(`${name} ${Math.round(performance.now() - started)} ms${result.startsWith('STUCK') || result.startsWith('blocked') ? ' FAILED' : ''}`)
    }
    say(`3-2-1-Go ${how}, ${situation}: ${results.join(', ')}`)
    setPendingRating(`3-2-1-Go ${how}, ${situation}`)
  }

  function rate(answer) {
    say(`HEARD? ${pendingRating}: ${answer}`)
    setPendingRating(null)
  }

  return (
    <div className="voice-test">
      <video ref={video} playsInline muted className="voice-preview" />
      <main>
        <h1>Voice test</h1>
        <p className="meta">{browser} · volume up, silent switch off. Stay at the phone for this one.</p>
        {!ready && <button className="primary big" onClick={start}>Allow camera + mic and start</button>}
        {error && <p className="note">{error}</p>}
        {ready && (
          <>
            <section className="card">
              <h3>{micOpen ? '🎙️ Mic open' : '🔇 Mic closed'}</h3>
              <div className="row">
                <button className="primary" onClick={() => run('normal')}>Play A</button>
                <button className="primary" onClick={() => run('webaudio')}>Play B</button>
              </div>
              <div className="row voice-row">
                <button className="secondary" onClick={() => countdown('normal')}>3-2-1-Go A</button>
                <button className="secondary" onClick={() => countdown('webaudio')}>3-2-1-Go B</button>
              </div>
              <button className="secondary voice-row" onClick={toggleMic}>{micOpen ? 'Close the mic' : 'Open the mic'}</button>
            </section>
            {pendingRating && (
              <section className="card warn">
                <h3>Could you hear it?</h3>
                <p className="meta">{pendingRating}</p>
                <div className="row">
                  <button className="primary" onClick={() => rate('clear')}>Clear</button>
                  <button className="secondary" onClick={() => rate('quiet')}>Quiet</button>
                  <button className="secondary" onClick={() => rate('nothing')}>Nothing</button>
                </div>
              </section>
            )}
            <section className="card">
              <h3>Do these four, rating each</h3>
              <ol className="steps">
                <li>Mic open: Play A, then Play B</li>
                <li>Mic open: 3-2-1-Go A, then B</li>
                <li>Close the mic: Play A, then Play B</li>
                <li>Open the mic again: Play A, then Play B</li>
              </ol>
            </section>
            <ul className="ai-steps voice-log">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </>
        )}
      </main>
    </div>
  )
}
