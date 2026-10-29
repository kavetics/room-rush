// Calls to the Room Rush server. In development Vite forwards /api to localhost:8787.

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function startScan(photoBlob) {
  const body = new FormData();
  body.append('photo', photoBlob, 'room.jpg');
  return json(await fetch('/api/scan', { method: 'POST', body }));
}

export async function getScan(id) {
  return json(await fetch(`/api/scan/${id}`));
}

export async function answerPlayers(id, players, seated) {
  return json(await fetch(`/api/scan/${id}/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ players, seated }),
  }));
}

export async function getGame(id, index) {
  return json(await fetch(`/api/scan/${id}/games/${index}`));
}

/** Shrink phone photos to 1280px before upload: faster upload and fewer AI tokens. */
export async function shrinkPhoto(file, maxSide = 1280) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}
