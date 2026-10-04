import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import { makeAccount } from '../../../testing/makeAccount.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { validationFailed } from '../../../testing/validationFailed.js'
import { useAccountEditing } from './useAccountEditing.js'

afterEach(() => { vi.restoreAllMocks() })

function editing() {
  const status = makeStatus()
  const hook = renderHook(() => useAccountEditing(status, async () => {}))
  act(() => hook.result.current.start(makeAccount()))
  return { hook, status }
}

describe('editing an account inline', () => {
  it('refuses a negative buffer and a bad currency on their own fields, without sending them', async () => {
    const patch = vi.spyOn(api, 'patch')
    const { hook } = editing()

    act(() => hook.result.current.change({ ...hook.result.current.editing!, bufferAmount: '-5', currencyCode: 'US' }))
    await act(() => hook.result.current.save())

    expect(hook.result.current.errors.fields).toEqual({
      bufferAmount: 'Cannot be negative.',
      currencyCode: 'Must be a 3-letter code, like USD.',
    })
    expect(patch).not.toHaveBeenCalled()
  })

  it('clears a field message when that field changes, and keeps the others', async () => {
    const { hook } = editing()
    act(() => hook.result.current.change({ ...hook.result.current.editing!, bufferAmount: '-5', name: ' ' }))
    await act(() => hook.result.current.save())

    act(() => hook.result.current.change({ ...hook.result.current.editing!, bufferAmount: '5' }))

    expect(hook.result.current.errors.fields).toEqual({ name: 'This cannot be empty.' })
  })

  it("puts the server's issue on the buffer, and the rest beside Save", async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(validationFailed(
      [['bufferAmount'], 'Buffer cannot be negative.'],
      [['accountType'], 'Must be one of: checking, savings.'],
    ))
    const { hook, status } = editing()

    await act(() => hook.result.current.save())

    expect(hook.result.current.errors).toEqual({
      fields: { bufferAmount: 'Buffer cannot be negative.' },
      form: 'Must be one of: checking, savings.',
    })
    expect(status.show).not.toHaveBeenCalled()
  })
})
