import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { makeTransaction } from '../../../testing/makeTransaction.js'
import { validationFailed } from '../../../testing/validationFailed.js'
import { useTransactionEditing } from './useTransactionEditing.js'

afterEach(() => { vi.restoreAllMocks() })

function editing(transferId: string | null = null) {
  const status = makeStatus()
  const hook = renderHook(() => useTransactionEditing(status, async () => {}))
  act(() => hook.result.current.start(makeTransaction({ transfer_id: transferId })))
  return { hook, status }
}

describe('editing a transaction inline', () => {
  it('refuses a blank merchant and a fifth decimal place, each on its own input', async () => {
    const patch = vi.spyOn(api, 'patch')
    const { hook } = editing()

    act(() => hook.result.current.change({ ...hook.result.current.editing!, merchant: ' ', amount: '-4.50001' }))
    await act(() => hook.result.current.save())

    expect(hook.result.current.errors.fields).toEqual({
      merchant: 'This cannot be empty.',
      amount: 'Enter an amount like 12.50, with no more than 4 decimal places.',
    })
    expect(patch).not.toHaveBeenCalled()
  })

  it("puts a transfer leg's refusal on its amount", async () => {
    const message = 'A transfer leg keeps its direction: the amount must stay non-zero and keep its sign. '
      + 'To reverse a transfer, delete it and record a new one.'
    vi.spyOn(api, 'patch').mockRejectedValue(validationFailed([['amount'], message]))
    const { hook, status } = editing('tr-1')

    await act(() => hook.result.current.save())

    expect(hook.result.current.errors).toEqual({ fields: { amount: message }, form: null })
    expect(hook.result.current.editing).not.toBeNull()
    expect(status.show).not.toHaveBeenCalled()
  })
})
