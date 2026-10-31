// Keeps a game on the phone so it survives a page reload. Nothing here leaves the phone.
const DB = 'room-rush'
const META = 'game'
const TURNS = 'turns'

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(META)
      request.result.createObjectStore(TURNS)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function run(store, mode, work) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const request = work(tx.objectStore(store))
    tx.oncomplete = () => { db.close(); resolve(request?.result) }
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error) }
  })
}

// Storage can be unavailable (private browsing, full phone): the game still runs, it just can't resume.
const quietly = promise => promise.catch(() => undefined)

export const saveGameState = state => quietly(run(META, 'readwrite', s => s.put(state, 'current')))
export const saveTurnMedia = (id, media) => quietly(run(TURNS, 'readwrite', s => s.put(media, id)))
export const dropTurnMedia = id => quietly(run(TURNS, 'readwrite', s => s.delete(id)))

export async function clearSavedGame() {
  await quietly(run(META, 'readwrite', s => s.clear()))
  await quietly(run(TURNS, 'readwrite', s => s.clear()))
}

/** The saved game with each turn's video and frames back in place, or null. */
export async function loadSavedGame() {
  const state = await quietly(run(META, 'readonly', s => s.get('current')))
  if (!state) return null
  const jobs = await Promise.all(state.jobs.map(async job => {
    const media = await quietly(run(TURNS, 'readonly', s => s.get(job.id)))
    if (!media) return { ...job, clip: { frames: [] }, lost: true }
    return { ...job, clip: { ...media, url: media.blob ? URL.createObjectURL(media.blob) : null } }
  }))
  // A turn with no saved footage can't be checked or replayed, so that player goes again.
  return { ...state, jobs: jobs.filter(j => !j.lost || j.status === 'done') }
}

export const hasSavedGame = () => loadSavedGame().then(Boolean).catch(() => false)
