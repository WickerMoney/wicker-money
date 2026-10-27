import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import { makeAccount } from '../../../testing/makeAccount.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { ToastsWrapper, findToast, toastTexts } from '../../../testing/toastTexts.js'
import { validationFailed } from '../../../testing/validationFailed.js'
import { useAccountEditing } from './useAccountEditing.js'

afterEach(() => { vi.restoreAllMocks() })

function editing() {
  const status = makeStatus()
  const hook = renderHook(() => useAccountEditing(status, async () => {}), { wrapper: ToastsWrapper })
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
    expect(toastTexts()).toEqual([])
  })

  it('says what was saved in a toast', async () => {
    vi.spyOn(api, 'patch').mockResolvedValue({})
    const { hook } = editing()
    act(() => hook.result.current.change({ ...hook.result.current.editing!, name: '  Everyday ' }))

    await act(() => hook.result.current.save())

    expect(await findToast()).toEqual(["Saved changes to 'Everyday'."])
    expect(hook.result.current.editing).toBeNull()
  })

  it('says so in a toast when the checkbox is saved, and when it is refused', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('nope'))
    const { hook, status } = editing()
    const account = makeAccount({ name: 'Savings' })

    await act(() => hook.result.current.setSpendable(account, true))
    expect(await findToast()).toEqual(["'Savings' now counts toward safe to spend."])

    await act(() => hook.result.current.setSpendable(account, false))
    // The same key: the failure replaces the confirmation instead of stacking.
    expect(await findToast('Error: nope')).toEqual(['Error: nope'])
    expect(patch).toHaveBeenCalledTimes(2)
    expect(status.show).not.toHaveBeenCalled()
  })
})
