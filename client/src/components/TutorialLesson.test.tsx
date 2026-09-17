import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TutorialLesson } from './TutorialLesson'

const frames = ['Frame A', 'Frame B', 'Frame C']
const durations = [200, 200, 200]

const renderLesson = () =>
  render(
    <TutorialLesson
      title="Record an expense"
      description="Type a sentence and confirm it."
      caption="Type a sentence and confirm it to add an expense."
      frameCount={frames.length}
      durations={durations}
      renderFrame={(step) => <p>{frames[step]}</p>}
    />,
  )

describe('TutorialLesson', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the heading, description and caption', () => {
    renderLesson()
    expect(screen.getByRole('heading', { name: 'Record an expense' })).toBeInTheDocument()
    expect(screen.getByText('Type a sentence and confirm it.')).toBeInTheDocument()
    expect(screen.getByText('Type a sentence and confirm it to add an expense.')).toBeInTheDocument()
  })

  it('has a real, focusable Replay button', async () => {
    renderLesson()
    const replay = screen.getByRole('button', { name: /replay/i })
    replay.focus()
    expect(replay).toHaveFocus()
  })

  it('plays through the frames on a timer (no IntersectionObserver in this test environment, so it autoplays)', () => {
    vi.useFakeTimers()
    renderLesson()

    expect(screen.getByText('Frame A')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByText('Frame B')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByText('Frame C')).toBeInTheDocument()

    // It does not loop back to Frame A.
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText('Frame C')).toBeInTheDocument()
  })

  it('replays from the first frame when Replay is clicked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderLesson()

    act(() => vi.advanceTimersByTime(400))
    expect(screen.getByText('Frame C')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /replay/i }))
    expect(screen.getByText('Frame A')).toBeInTheDocument()
  })

  it('keeps every frame mounted (hidden, not unmounted) so the stage never resizes as it plays', () => {
    vi.useFakeTimers()
    renderLesson()

    // All three frames exist in the DOM from the start — that's what lets a
    // CSS grid reserve room for the tallest one before any of them show.
    const frameA = screen.getByText('Frame A').closest('div')!
    const frameB = screen.getByText('Frame B').closest('div')!
    const frameC = screen.getByText('Frame C').closest('div')!

    // Only the active frame is visible and exposed to assistive tech.
    expect(frameA).not.toHaveAttribute('aria-hidden')
    expect(frameA).toHaveStyle({ visibility: 'visible' })
    expect(frameB).toHaveAttribute('aria-hidden', 'true')
    expect(frameB).toHaveStyle({ visibility: 'hidden' })
    expect(frameC).toHaveAttribute('aria-hidden', 'true')
    expect(frameC).toHaveStyle({ visibility: 'hidden' })

    act(() => vi.advanceTimersByTime(200))

    // The hand-off moves, the DOM presence doesn't.
    expect(screen.getByText('Frame A').closest('div')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Frame B').closest('div')).not.toHaveAttribute('aria-hidden')
  })

  it('under reduced motion, shows the final frame and the caption immediately, with no empty box', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))

    renderLesson()

    expect(screen.getByText('Frame C')).toBeInTheDocument()
    expect(screen.getByText('Type a sentence and confirm it to add an expense.')).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('has no Replay button under reduced motion — the frame is already still, so there is nothing to replay', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))

    renderLesson()

    expect(screen.queryByRole('button', { name: /replay/i })).not.toBeInTheDocument()

    vi.unstubAllGlobals()
  })
})
