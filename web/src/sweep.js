// Guided room scan helpers: which way the camera points, so the app can guide the host
// to 8 directions plus the ceiling and take each photo when the phone is lined up and still.

export const SCAN = {
  sides: 8, // one photo every 45°, all the way around
  stepDeg: 45,
  alignDeg: 10, // close enough to the target direction
  levelDeg: 35, // side photos: camera roughly level, not at the floor or ceiling
  ceilingDeg: 30, // ceiling photo: camera tilted up at least this much (the frame's top edge is then ~60° up)
  steadySpreadDeg: 5, // "still" = the phone moved less than this…
  steadyWindowMs: 300, // …over this long
  steadyMs: 400, // hold still this long before the photo is taken
  minSidesForDone: 4,
  // No compass (desktop, or motion access denied): timed prompts instead.
  timedTurnMs: 2500,
  timedHoldMs: 1200,
}

/** iPhone asks permission for motion sensors; it must be requested from a tap. */
export function askMotionPermission() {
  const ask = window.DeviceOrientationEvent?.requestPermission
  if (typeof ask === 'function') ask.call(DeviceOrientationEvent).catch(() => {})
}

/**
 * Where the back camera points, from the phone's orientation angles. Works however the phone
 * is held. heading: 0–360°, increases when turning right (zero point is arbitrary, only changes
 * matter); null when pointing almost straight up or down. pitch: −90 (floor) to 90 (ceiling).
 */
export function cameraDirection({ alpha, beta, gamma }) {
  if (alpha == null || beta == null || gamma == null) return null
  const r = Math.PI / 180
  const [cA, sA, cB, sB, cG, sG] = [Math.cos(alpha * r), Math.sin(alpha * r), Math.cos(beta * r), Math.sin(beta * r), Math.cos(gamma * r), Math.sin(gamma * r)]
  // The back camera looks along the phone's −z axis; rotate it into world coordinates.
  const x = -(cG * sA * sB + cA * sG)
  const y = -(sA * sG - cA * cG * sB)
  const z = -(cB * cG)
  const pitch = Math.asin(Math.max(-1, Math.min(1, z))) / r
  const heading = Math.hypot(x, y) < 0.2 ? null : (Math.atan2(x, y) / r + 360) % 360
  return { heading, pitch }
}

/** Signed turn from one direction to another, −180..180 (positive = turn right). */
export function turnTo(from, to) {
  return ((to - from + 540) % 360) - 180
}
