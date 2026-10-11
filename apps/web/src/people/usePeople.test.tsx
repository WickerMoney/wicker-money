import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Person } from '../models/index.js'

const fetchPeople = vi.fn<() => Promise<Person[]>>()
vi.mock('./peopleApi.js', () => ({ fetchPeople }))

const { usePeople } = await import('./usePeople.js')

const someone: Person = { id: 'a', email: 'a@example.com', role: 'owner', createdAt: '2026-10-01T00:00:00.000Z' }

beforeEach(() => { fetchPeople.mockReset() })

describe('usePeople', () => {
  it('does not ask the server at all when not enabled', () => {
    const { result } = renderHook(() => usePeople(false))
    expect(result.current).toEqual({ kind: 'skipped' })
    expect(fetchPeople).not.toHaveBeenCalled()
  })

  it('is loading, then has the people', async () => {
    fetchPeople.mockResolvedValue([someone])
    const { result } = renderHook(() => usePeople(true))
    expect(result.current).toEqual({ kind: 'loading' })
    await waitFor(() => { expect(result.current).toEqual({ kind: 'loaded', people: [someone] }) })
  })

  it('reports the server\'s message when the request fails', async () => {
    fetchPeople.mockRejectedValue(new Error('Only an owner can do this.'))
    const { result } = renderHook(() => usePeople(true))
    await waitFor(() => { expect(result.current).toEqual({ kind: 'error', message: 'Only an owner can do this.' }) })
  })

  it('falls back to a plain message for something that is not an Error', async () => {
    fetchPeople.mockRejectedValue('nope')
    const { result } = renderHook(() => usePeople(true))
    await waitFor(() => { expect(result.current).toEqual({ kind: 'error', message: 'Could not load people.' }) })
  })

  it('ignores an answer that arrives after the component is gone', async () => {
    let resolve: (p: Person[]) => void = () => {}
    fetchPeople.mockReturnValue(new Promise((r) => { resolve = r }))
    const { result, unmount } = renderHook(() => usePeople(true))
    unmount()
    resolve([someone])
    await Promise.resolve()
    expect(result.current).toEqual({ kind: 'loading' })
  })
})
