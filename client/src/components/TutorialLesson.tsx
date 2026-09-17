// One lesson component, reused four times by HowToUsePage with a different
// script each time — docs/specs/12-how-to-use.md §4 and §7. Owns the timing
// (play-once-on-scroll-into-view, Replay, reduced motion); the caller only
// supplies what each frame looks like, built from the app's real components.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { useTutorialSequencer } from '../hooks/useTutorialSequencer'
import { ReplayIcon } from './icons'

interface TutorialLessonProps {
  title: string
  description: string
  caption: string
  frameCount: number
  /** Ms to hold each frame before advancing to the next. The last entry is
   *  never used (there is nothing after the last frame). */
  durations: number[]
  /** `playToken` changes every time a play starts (first view, or Replay) —
   *  frame renderers use it to restart their own sub-animations, such as a
   *  composer typing a sentence back in from empty. `isActive` is false while
   *  another lesson holds the shared play slot — a frame with its own timer
   *  (e.g. useTypedText) should stay paused rather than keep animating for a
   *  lesson that yielded. `frameId` is a stable id unique to this frame
   *  instance — pass it down to anything that needs a DOM id (e.g.
   *  `ChatScreen`'s composer), since every frame of every lesson is mounted
   *  at once and a literal id would repeat across the page. */
  renderFrame: (step: number, playToken: number, isActive: boolean, frameId: string) => ReactNode
  /** Under `prefers-reduced-motion: reduce`, which steps to show — stacked,
   *  in document order, all at once — instead of the single final frame.
   *  Spec §4: a lesson whose point is draft-then-confirm needs the confirm
   *  step shown too, not just the outcome ("Done."). Defaults to just the
   *  last frame, which is enough for a lesson whose final frame already is
   *  the outcome (e.g. a lesson with no separate confirm step). */
  reducedMotionSteps?: number[]
}

export const TutorialLesson = ({
  title,
  description,
  caption,
  frameCount,
  durations,
  renderFrame,
  reducedMotionSteps = [frameCount - 1],
}: TutorialLessonProps) => {
  const prefersReducedMotion = usePrefersReducedMotion()
  const sequencer = useTutorialSequencer()
  const id = useId()
  const [step, setStep] = useState(0)
  const [playToken, setPlayToken] = useState(0)
  const hasPlayedRef = useRef(false)
  const stageRef = useRef<HTMLDivElement>(null)

  const play = () => {
    hasPlayedRef.current = true
    setStep(0)
    setPlayToken((n) => n + 1)
  }

  // Replay is the reader asking explicitly, so it always wins: it plays
  // immediately and takes the shared play slot from whatever held it.
  const replay = () => {
    play()
    sequencer?.claim(id)
  }

  // Registers with the shared sequencer, which hands out the single play
  // slot to whichever lesson is most in view (spec §4). Falls back to
  // playing as soon as it scrolls into view where there's no sequencer —
  // TutorialLesson used on its own — or no IntersectionObserver at all.
  useEffect(() => {
    if (prefersReducedMotion || hasPlayedRef.current) return
    const node = stageRef.current
    if (!node) return
    if (sequencer) return sequencer.register(id, node)
    if (typeof IntersectionObserver === 'undefined') {
      play()
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasPlayedRef.current) play()
      },
      { threshold: 0.4 },
    )
    observer.observe(node)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefersReducedMotion])

  // Starts this lesson's own play once the sequencer hands it the slot.
  useEffect(() => {
    if (prefersReducedMotion || hasPlayedRef.current) return
    if (sequencer && sequencer.activeId === id) play()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequencer?.activeId, prefersReducedMotion])

  // Steps through the frames, one setTimeout at a time, restarting whenever
  // a new play begins. Cleaned up on unmount, on the next play, or the
  // moment another lesson takes the slot (it yields rather than keep going
  // off-screen or alongside whatever just started).
  useEffect(() => {
    if (prefersReducedMotion || playToken === 0) return
    if (sequencer && sequencer.activeId !== id) return
    let cancelled = false
    let index = 0
    let timer: ReturnType<typeof setTimeout>
    const advance = () => {
      if (cancelled) return
      if (index >= frameCount - 1) {
        sequencer?.notifyDone(id)
        return
      }
      timer = setTimeout(() => {
        if (cancelled) return
        index += 1
        setStep(index)
        advance()
      }, durations[index] ?? 0)
    }
    advance()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playToken, frameCount, durations, prefersReducedMotion, sequencer?.activeId])

  const isActive = !sequencer || sequencer.activeId === id
  const frameId = (frameStep: number) => `${id}-frame-${frameStep}`

  return (
    <article className="lesson">
      <h2>{title}</h2>
      <p className="lesson__text">{description}</p>

      <section className="lesson__animation" aria-label={`${title} animation`}>
        {prefersReducedMotion ? (
          // Reduced motion: no timer, nothing plays. Render just the steps
          // this lesson needs to tell the story while still (spec §4) —
          // stacked in normal document flow, not the grid-of-frames trick
          // below, since here more than one frame is genuinely visible at
          // once. The stage still reserves no fixed height; it simply grows
          // to fit whichever frames are shown, which spec §4 says costs
          // nothing.
          <div className="lesson__stage lesson__stage--still" aria-hidden="true" ref={stageRef}>
            {reducedMotionSteps.map((frameStep) => (
              <div key={`still-${frameStep}`} className="lesson__frame lesson__frame--still">
                {renderFrame(frameStep, playToken, isActive, frameId(frameStep))}
              </div>
            ))}
          </div>
        ) : (
          // Every frame is mounted for the whole play, stacked in the same CSS
          // grid cell (.lesson__frame — see index.css). A grid track sizes
          // itself to the largest item placed in it, so the stage is always
          // as tall as its tallest frame, whichever one is showing — no
          // hardcoded height, and it still holds if a frame's content changes
          // or the viewport narrows. Only the active frame is visible;
          // the rest are `visibility: hidden` rather than unmounted, which
          // keeps them (and the grid) sized but out of sight, out of the
          // accessibility tree and out of tab order.
          // Each frame is keyed by playToken + its own step so a new play
          // (first view, or Replay) remounts every frame fresh — that's what
          // lets a frame's own timer (e.g. useTypedText) restart from empty
          // instead of syncing a reset via an effect.
          <div className="lesson__stage" aria-hidden="true" ref={stageRef}>
            {Array.from({ length: frameCount }, (_, frameStep) => {
              const active = frameStep === step
              return (
                <div
                  key={`${playToken}-${frameStep}`}
                  className="lesson__frame"
                  style={{ visibility: active ? 'visible' : 'hidden' }}
                  aria-hidden={active ? undefined : true}
                >
                  {renderFrame(frameStep, playToken, isActive, frameId(frameStep))}
                </div>
              )
            })}
          </div>
        )}
        <p className="lesson__caption">{caption}</p>
        {/* Under reduced motion the frame above is already still — there is
            no animation to replay, and a control that does nothing when
            pressed is worse than no control (spec §4 review). */}
        {!prefersReducedMotion && (
          <button type="button" className="lesson__replay" onClick={replay} aria-label={`Replay ${title} animation`}>
            <ReplayIcon />
            Replay &ldquo;{title}&rdquo;
          </button>
        )}
      </section>
    </article>
  )
}
