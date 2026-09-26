import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useHiddenSeries } from './useHiddenSeries.js'

describe('useHiddenSeries', () => {
  it('starts with everything shown', () => {
    expect(renderHook(() => useHiddenSeries()).result.current.hidden.size).toBe(0)
  })

  it('hides a series on the first toggle and shows it again on the second', () => {
    const { result } = renderHook(() => useHiddenSeries())
    act(() => result.current.toggle('a'))
    expect(result.current.hidden.has('a')).toBe(true)
    act(() => result.current.toggle('a'))
    expect(result.current.hidden.has('a')).toBe(false)
  })

  it('keeps toggles independent', () => {
    const { result } = renderHook(() => useHiddenSeries())
    act(() => result.current.toggle('a'))
    act(() => result.current.toggle('b'))
    act(() => result.current.toggle('a'))
    expect([...result.current.hidden]).toEqual(['b'])
  })

  it('returns a stable toggle, so a memoised child is not re-rendered for nothing', () => {
    const { result } = renderHook(() => useHiddenSeries())
    const first = result.current.toggle
    act(() => result.current.toggle('a'))
    expect(result.current.toggle).toBe(first)
  })
})
