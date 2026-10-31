import { report } from './useCamera.js'

// Voice instructions. All clips load into memory up front, and the game's timing never waits on them:
// if a clip can't play, the sound is lost, not the rhythm.
const CLIPS = ['cant-tell', 'catch', 'catch-chest', 'catch-one', 'caught', 'checking', 'clap-1', 'clap-2', 'clap-3', 'clap-after', 'clap-drop', 'count-0', 'count-1', 'count-10', 'count-2', 'count-3', 'count-4', 'count-5', 'count-6', 'count-7', 'count-8', 'count-9', 'done', 'drop', 'drop-pick', 'dropped', 'finished', 'game-over', 'get-ball', 'getting-results', 'go', 'hear', 'n1', 'n2', 'n3', 'next-player', 'reset', 'results-ready', 'right', 'round-over', 'start', 'stop', 'throw', 'wrong', 'your-turn']
const START_LIMIT_MS = 400 // not playing by now: switch to Web Audio
const MAX_CLIP_MS = 6000

const voice = typeof Audio === 'undefined' ? null : new Audio()
let context = null
let loading = null
const urls = {}
const buffers = {}

function load() {
  loading ??= Promise.all(CLIPS.map(async name => {
    const blob = await (await fetch(`/voice/${name}.m4a`)).blob()
    urls[name] = URL.createObjectURL(blob)
    buffers[name] = await context.decodeAudioData(await blob.arrayBuffer())
  })).catch(err => { report(`voice load failed: ${err.message}`); loading = null })
  return loading
}

/** Call directly inside a tap: iPhone only allows sound that starts from a tap. Then the app can speak by itself. */
export function prepareVoice() {
  if (!context) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    context = new Ctx()
  }
  context.resume().catch(() => {})
  voice.play().catch(() => {})
  return load()
}

function playBuffer(name, finish) {
  if (!buffers[name] || !context) return finish()
  context.resume().catch(() => {})
  const source = context.createBufferSource()
  source.buffer = buffers[name]
  source.connect(context.destination)
  source.onended = finish
  source.start()
}

/** Plays a clip. Resolves when it ends, or at a time limit if it's stuck, so nothing can hang on it. */
export function playClip(name) {
  return new Promise(resolve => {
    let done = false
    let fellBack = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(limit)
      clearTimeout(startCheck)
      resolve()
    }
    const limit = setTimeout(() => { report(`voice stuck: ${name}`); finish() }, MAX_CLIP_MS)
    const fallBack = why => {
      if (fellBack || done) return
      fellBack = true
      report(`voice fallback: ${name} (${why}; ready ${voice.readyState}, network ${voice.networkState})`)
      voice.pause()
      playBuffer(name, finish)
    }
    const startCheck = setTimeout(() => { if (voice.paused || voice.currentTime === 0) fallBack('slow start') }, START_LIMIT_MS)
    voice.onended = finish
    voice.onerror = () => fallBack('error')
    voice.src = urls[name] ?? `/voice/${name}.m4a`
    voice.volume = 1
    voice.play().then(() => report(`voice playing: ${name}`)).catch(err => { if (err.name !== 'AbortError') fallBack(err.name) })
  })
}
