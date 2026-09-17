// Covers docs/specs/12-how-to-use.md §4: "only one animation ever plays at a
// time, and it is the one the reader is looking at." TutorialLesson.test.tsx
// covers a single lesson in isolation (no IntersectionObserver in jsdom, so
// it just autoplays on mount); these tests cover what happens once several
// lessons share a TutorialSequencerProvider, which is where the bug was —
// every lesson used to start on its own.
import { StrictMode } from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TutorialLesson } from './TutorialLesson'
import { TutorialSequencerProvider } from '../hooks/useTutorialSequencer'
import { useTypedText } from '../hooks/useTypedText'

// A controllable stand-in for the browser's IntersectionObserver: tests
// decide each lesson's visibility by calling the captured callback directly,
// the same way the coordinator's own (single, shared) observer would.
class FakeIntersectionObserver {
  static current: FakeIntersectionObserver | null = null
  callback: IntersectionObserverCallback
  observed: Element[] = []
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeIntersectionObserver.current = this
  }
  observe(node: Element) {
    this.observed.push(node)
  }
  unobserve(node: Element) {
    this.observed = this.observed.filter((n) => n !== node)
  }
  disconnect() {}
  takeRecords() {
    return []
  }
}

const entry = (target: Element, intersectionRatio: number) => ({ target, intersectionRatio }) as IntersectionObserverEntry

const framesA = ['A0', 'A1', 'A2']
const framesB = ['B0', 'B1', 'B2']

// A frame with its own sub-animation (like the real composer-typing frames
// in HowToUsePage) — used to check that yielding stops that too, not just
// the outer frame count.
const TypingFrame = ({ step, isActive }: { step: number; isActive: boolean }) => {
  const typed = useTypedText('hello', step === 0 && isActive, 1000)
  return <p>{typed || 'EMPTY'}</p>
}

const renderTwoLessons = () =>
  render(
    <TutorialSequencerProvider>
      <TutorialLesson
        title="First"
        description="d1"
        caption="c1"
        frameCount={3}
        durations={[100, 100, 100]}
        renderFrame={(step) => <p>{framesA[step]}</p>}
      />
      <TutorialLesson
        title="Second"
        description="d2"
        caption="c2"
        frameCount={3}
        durations={[100, 100, 100]}
        renderFrame={(step) => <p>{framesB[step]}</p>}
      />
    </TutorialSequencerProvider>,
  )

describe('TutorialSequencerProvider', () => {
  afterEach(() => {
    vi.useRealTimers()
    // Always restore, even if an assertion above threw — otherwise a failed
    // test leaks its stubbed globals (e.g. IntersectionObserver) into the
    // next test and produces a confusing, unrelated failure there too.
    vi.unstubAllGlobals()
    FakeIntersectionObserver.current = null
  })

  it('plays only the most-visible lesson; the other waits at its first frame until its turn', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    vi.useFakeTimers()
    renderTwoLessons()

    // Both are on screen at once (the normal desktop case) — neither has
    // started yet, so both sit at their own first frame.
    expect(screen.getByText('A0')).toBeInTheDocument()
    expect(screen.getByText('B0')).toBeInTheDocument()

    const observer = FakeIntersectionObserver.current!
    act(() => {
      observer.callback(
        [entry(observer.observed[0], 0.5), entry(observer.observed[1], 0.9)],
        observer as unknown as IntersectionObserver,
      )
    })

    // Second is more in view, so it plays; First keeps waiting.
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByText('B1')).toBeInTheDocument()
    expect(screen.getByText('A0')).toBeInTheDocument()

    // Second finishes its one play — First never got a chance to start
    // early, and now takes its turn.
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByText('B2')).toBeInTheDocument()
    expect(screen.getByText('A0')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByText('A1')).toBeInTheDocument()
    // Second doesn't loop or restart while First plays.
    expect(screen.getByText('B2')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('Replay takes the slot immediately, and whatever was mid-play yields', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderTwoLessons()

    const observer = FakeIntersectionObserver.current!
    act(() => {
      observer.callback(
        [entry(observer.observed[0], 0.5), entry(observer.observed[1], 0.9)],
        observer as unknown as IntersectionObserver,
      )
    })
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByText('B1')).toBeInTheDocument()
    expect(screen.getByText('A0')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /replay.*first/i }))

    // First restarted immediately...
    expect(screen.getByText('A0')).toBeInTheDocument()

    // ...and Second, which was mid-play, is frozen where it was — it does
    // not keep advancing even though more time passes.
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByText('A1')).toBeInTheDocument()
    expect(screen.getByText('B1')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it("a yielded lesson's own sub-animation stops too — it does not keep typing in the background", async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(
      <TutorialSequencerProvider>
        <TutorialLesson
          title="First"
          description="d1"
          caption="c1"
          frameCount={2}
          durations={[1000, 0]}
          renderFrame={(step, _token, isActive) => <TypingFrame step={step} isActive={isActive} />}
        />
        <TutorialLesson
          title="Second"
          description="d2"
          caption="c2"
          frameCount={2}
          durations={[1000, 0]}
          renderFrame={(step) => <p>{step === 0 ? 'B0' : 'B1'}</p>}
        />
      </TutorialSequencerProvider>,
    )

    const observer = FakeIntersectionObserver.current!
    act(() => {
      observer.callback([entry(observer.observed[0], 1)], observer as unknown as IntersectionObserver)
    })

    // Partway through typing "hello" — some but not all of it revealed.
    act(() => vi.advanceTimersByTime(300))
    const partial = screen.getByText(/^h/i).textContent
    expect(partial).not.toBe('hello')
    expect(partial).not.toBe('EMPTY')

    // Second is replayed — First yields the slot.
    await user.click(screen.getByRole('button', { name: /replay.*second/i }))

    // First's typing does not keep completing in the background.
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByText(partial!)).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('under reduced motion, every lesson still shows its final frame with no motion at all', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    renderTwoLessons()

    expect(screen.getByText('A2')).toBeInTheDocument()
    expect(screen.getByText('B2')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('under StrictMode, every lesson still gets its turn — election is not corrupted by React double-invoking it in dev', () => {
    // React Strict Mode calls a `setState(current => ...)` updater twice in
    // dev to check it's pure. electLeader used to mutate `played` inside
    // exactly that kind of updater, so the discarded second call still
    // marked a second, not-yet-run lesson as played — every lesson after
    // the first was then permanently excluded from ever being chosen.
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    vi.useFakeTimers()
    render(
      <StrictMode>
        <TutorialSequencerProvider>
          <TutorialLesson
            title="First"
            description="d1"
            caption="c1"
            frameCount={2}
            durations={[100, 0]}
            renderFrame={(step) => <p>{framesA[step]}</p>}
          />
          <TutorialLesson
            title="Second"
            description="d2"
            caption="c2"
            frameCount={2}
            durations={[100, 0]}
            renderFrame={(step) => <p>{framesB[step]}</p>}
          />
        </TutorialSequencerProvider>
      </StrictMode>,
    )

    const observer = FakeIntersectionObserver.current!
    act(() => {
      observer.callback(
        [entry(observer.observed[0], 0.9), entry(observer.observed[1], 0.5)],
        observer as unknown as IntersectionObserver,
      )
    })

    // First (most visible) plays and finishes.
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByText('A1')).toBeInTheDocument()

    // Second must still get its turn — it must not have been silently
    // marked "played" while First was merely being elected.
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByText('B1')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('without an IntersectionObserver, still plays one lesson at a time in mount order rather than starting every lesson at once', () => {
    // This project's test environment has no IntersectionObserver — this is
    // the exact fallback path that used to call play() for every lesson at
    // once (the original bug).
    vi.useFakeTimers()
    render(
      <TutorialSequencerProvider>
        <TutorialLesson
          title="First"
          description="d1"
          caption="c1"
          frameCount={2}
          durations={[100, 0]}
          renderFrame={(step) => <p>{framesA[step]}</p>}
        />
        <TutorialLesson
          title="Second"
          description="d2"
          caption="c2"
          frameCount={2}
          durations={[100, 0]}
          renderFrame={(step) => <p>{framesB[step]}</p>}
        />
      </TutorialSequencerProvider>,
    )

    expect(screen.getByText('A0')).toBeInTheDocument()
    expect(screen.getByText('B0')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByText('A1')).toBeInTheDocument()
    // Second has not started yet — it was waiting its turn, not playing
    // alongside First.
    expect(screen.getByText('B0')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByText('B1')).toBeInTheDocument()
  })
})
