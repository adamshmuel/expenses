import { useEffect, useState } from 'react'

/** Roughly how long a person takes to type one character, before jitter.
 *  ~45ms/character reads as a fast, confident typist rather than an instant
 *  fill — see `typingDurationMs`. */
const MS_PER_CHARACTER = 45

/** The composer's typing step, sized to the sentence — long enough to read
 *  as someone typing it, short enough that a lesson still finishes in a few
 *  seconds (spec §4). */
export const typingDurationMs = (text: string) => Math.round(text.length * MS_PER_CHARACTER)

/**
 * Reveals `text` one character at a time, each with its own small random
 * delay, while `active` is true — a human's uneven typing rhythm rather than
 * a fixed metronome (spec §4). The delays are rescaled so the sentence is
 * always fully typed by `durationMs`, however the random draw falls; pass
 * `typingDurationMs(text)` to size that to the sentence.
 *
 * The caller resets it between plays by remounting (TutorialLesson keys its
 * stage by `playToken`) rather than this hook syncing a reset via an effect.
 */
export const useTypedText = (text: string, active: boolean, durationMs = 700) => {
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (!active || !text) return
    const timers: ReturnType<typeof setTimeout>[] = []
    let at = 0
    for (let charCount = 1; charCount <= text.length; charCount += 1) {
      // Each keystroke lands a bit early or late (±30%) instead of on a
      // metronome. The very last one is pinned to durationMs exactly, so the
      // sentence is always fully typed by the time the caller moves on.
      const jitter = 0.7 + Math.random() * 0.6
      at = Math.min(durationMs, at + (durationMs / text.length) * jitter)
      const fireAt = charCount === text.length ? durationMs : at
      const revealed = text.slice(0, charCount)
      timers.push(setTimeout(() => setTyped(revealed), fireAt))
    }
    return () => timers.forEach(clearTimeout)
  }, [text, active, durationMs])

  return typed
}
