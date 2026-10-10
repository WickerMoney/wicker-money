import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { useReferenceData } from './useReferenceData.js'

afterEach(() => { vi.restoreAllMocks() })

describe('useReferenceData', () => {
  it('fills the account pickers from the names-only accounts list, not the one that sums balances', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/accounts')) return [{ id: 'a1', name: 'Checking' }] as never
      return [] as never
    })
    const { result } = renderHook(() => useReferenceData(makeStatus()))
    await waitFor(() => expect(result.current.accounts).toHaveLength(1))
    const paths = get.mock.calls.map((c) => String(c[0]))
    expect(paths).toContain('/accounts?fields=basic')
    expect(paths).not.toContain('/accounts')
  })
})
