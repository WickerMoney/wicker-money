import { afterEach, describe, expect, it, vi } from 'vitest'
import { newUuid } from './newUuid.js'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newUuid', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses crypto.randomUUID when the page is a secure context', () => {
    const randomUUID = vi.fn(() => '3b241101-e2bb-4255-8caf-4136c566a962')
    vi.stubGlobal('crypto', { randomUUID, getRandomValues: crypto.getRandomValues.bind(crypto) })

    expect(newUuid()).toBe('3b241101-e2bb-4255-8caf-4136c566a962')
    expect(randomUUID).toHaveBeenCalledOnce()
  })

  it('falls back to getRandomValues over plain HTTP, where randomUUID is missing', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })

    const id = newUuid()

    expect(id).toMatch(V4)
  })

  it('sets the version and variant bits in the fallback', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(0xff) })

    expect(newUuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })

  it('does not repeat across calls in the fallback', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })

    const ids = new Set(Array.from({ length: 100 }, () => newUuid()))

    expect(ids.size).toBe(100)
  })
})
