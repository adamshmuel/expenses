import { describe, expect, it, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTypedText } from './useTypedText'

describe('useTypedText', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts empty and reveals the full text over the given duration while active', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useTypedText('spent 50', true, 400))

    expect(result.current).toBe('')

    act(() => vi.advanceTimersByTime(400))
    expect(result.current).toBe('spent 50')
  })

  it('does not reveal anything while inactive', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useTypedText('hi', false, 200))
    act(() => vi.advanceTimersByTime(500))
    expect(result.current).toBe('')
  })

  it('starts revealing once it becomes active', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ active }) => useTypedText('hi', active, 200), {
      initialProps: { active: false },
    })
    act(() => vi.advanceTimersByTime(500))
    expect(result.current).toBe('')

    rerender({ active: true })
    act(() => vi.advanceTimersByTime(200))
    expect(result.current).toBe('hi')
  })
})
