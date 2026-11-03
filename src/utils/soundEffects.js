// src/utils/soundEffects.js
// Native Web Audio API Synthesizer for Pulse
// Zero audio assets, zero network downloads, runs offline, cross-browser compatible.

let audioCtx = null

function getAudioContext() {
  if (typeof window === 'undefined') return null
  try {
    if (!audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (AudioCtx) {
        audioCtx = new AudioCtx()
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {})
    }
    return audioCtx
  } catch (e) {
    return null
  }
}

/**
 * Ascending crystal chime on successful login / session resume
 */
export function playLoginSuccessChime() {
  try {
    const ctx = getAudioContext()
    if (!ctx) return
    const now = ctx.currentTime

    // E5 (659.25Hz) -> G#5 (830.61Hz) -> B5 (987.77Hz) -> E6 (1318.51Hz)
    const notes = [659.25, 830.61, 987.77, 1318.51]

    notes.forEach((freq, idx) => {
      const startTime = now + idx * 0.07
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, startTime)

      gain.gain.setValueAtTime(0, startTime)
      gain.gain.linearRampToValueAtTime(0.08, startTime + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.45)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(startTime)
      osc.stop(startTime + 0.5)
    })
  } catch (e) {
    // Graceful fallback if audio is not permitted by browser autoplay policy
  }
}

/**
 * Cute micro-meow sound when clicking or interacting with Prof K's Orange Cat
 */
export function playCatMeowSound() {
  try {
    const ctx = getAudioContext()
    if (!ctx) return
    const now = ctx.currentTime

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    // Pitch envelope mimicking a tiny playful meow
    osc.frequency.setValueAtTime(580, now)
    osc.frequency.exponentialRampToValueAtTime(860, now + 0.12)
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.32)

    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.07, now + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.38)
  } catch (e) {
    // Silent fallback
  }
}

