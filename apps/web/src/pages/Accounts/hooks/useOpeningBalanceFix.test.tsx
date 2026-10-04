import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import type { BalancePreview } from '../../../models/index.js'
import { deferred } from '../../../testing/deferred.js'
import { makeAccount } from '../../../testing/makeAccount.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { validationFailed } from '../../../testing/validationFailed.js'
import { useOpeningBalanceFix } from './useOpeningBalanceFix.js'

const previewFor = (newBalance: string): BalancePreview => ({
  currentInitialBalance: '100.00', currentBalance: '250.00',
  newInitialBalance: newBalance, newBalance, delta: '1.00',
})

function setup() {
  const status = makeStatus()
  const reload = vi.fn(async () => {})
  const showNotice = vi.fn()
  const hook = renderHook(() => useOpeningBalanceFix(status, reload, showNotice))
  return { ...hook, status, reload, showNotice }
}

afterEach(() => { vi.restoreAllMocks() })

describe('useOpeningBalanceFix', () => {
  it('opens pre-filled with the current opening balance and no preview', () => {
    const { result } = setup()

    act(() => result.current.open(makeAccount({ initialBalance: '100.00' })))

    expect(result.current.fixing?.id).toBe('acc-1')
    expect(result.current.balanceInput).toBe('100.00')
    expect(result.current.balancePreview).toBeNull()
  })

  it('previews the typed value', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(previewFor('300.00'))
    const { result } = setup()
    act(() => result.current.open(makeAccount()))

    await act(async () => { await result.current.preview('300.00') })

    expect(post).toHaveBeenCalledWith(
      '/accounts/acc-1/initial-balance/preview', { initialBalance: '300.00' }, expect.anything(),
    )
    expect(result.current.balancePreview?.newBalance).toBe('300.00')
  })

  it('does not apply a stale preview when overlapping previews resolve out of order', async () => {
    const first = deferred<BalancePreview>()
    const second = deferred<BalancePreview>()
    vi.spyOn(api, 'post').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = setup()
    act(() => result.current.open(makeAccount()))

    let p1: Promise<void> = Promise.resolve()
    let p2: Promise<void> = Promise.resolve()
    act(() => { p1 = result.current.preview('3') })
    act(() => { p2 = result.current.preview('30') })
    // The newer request answers first, then the older one straggles in.
    await act(async () => { second.resolve(previewFor('30.00')); await p2 })
    await act(async () => { first.resolve(previewFor('3.00')); await p1 })

    expect(result.current.balanceInput).toBe('30')
    expect(result.current.balancePreview?.newBalance).toBe('30.00')
  })

  it('drops a reply that is still in flight when the field is cleared', async () => {
    const pending = deferred<BalancePreview>()
    vi.spyOn(api, 'post').mockReturnValueOnce(pending.promise)
    const { result } = setup()
    act(() => result.current.open(makeAccount()))

    let p: Promise<void> = Promise.resolve()
    act(() => { p = result.current.preview('3') })
    await act(async () => { await result.current.preview('') })
    await act(async () => { pending.resolve(previewFor('3.00')); await p })

    expect(result.current.balancePreview).toBeNull()
  })

  it('drops a reply that arrives after the panel was closed', async () => {
    const pending = deferred<BalancePreview>()
    vi.spyOn(api, 'post').mockReturnValueOnce(pending.promise)
    const { result } = setup()
    act(() => result.current.open(makeAccount()))

    let p: Promise<void> = Promise.resolve()
    act(() => { p = result.current.preview('3') })
    act(() => result.current.cancel())
    await act(async () => { pending.resolve(previewFor('3.00')); await p })

    expect(result.current.fixing).toBeNull()
    expect(result.current.balancePreview).toBeNull()
  })

  it('names a value the API would refuse under the field, without asking it', async () => {
    const post = vi.spyOn(api, 'post')
    const { result, status } = setup()
    act(() => result.current.open(makeAccount()))

    await act(async () => { await result.current.preview('12.34567') })

    expect(result.current.balancePreview).toBeNull()
    expect(result.current.errors.fields).toEqual({
      initialBalance: 'Enter an amount like 12.50, with no more than 4 decimal places.',
    })
    expect(post).not.toHaveBeenCalled()
    expect(status.show).not.toHaveBeenCalled()
  })

  it("puts the server's refusal of the previewed value on the field", async () => {
    vi.spyOn(api, 'post').mockRejectedValue(validationFailed([['initialBalance'], 'Enter an amount like 12.50, with no more than 4 decimal places.']))
    const { result } = setup()
    act(() => result.current.open(makeAccount()))

    await act(async () => { await result.current.preview('5') })

    expect(result.current.errors.fields['initialBalance']).toBe('Enter an amount like 12.50, with no more than 4 decimal places.')
  })

  it('applies the previewed value, reloads and reports the change', async () => {
    const post = vi.spyOn(api, 'post')
      .mockResolvedValueOnce(previewFor('300.00'))
      .mockResolvedValueOnce({})
    const { result, status, reload, showNotice } = setup()
    act(() => result.current.open(makeAccount()))
    await act(async () => { await result.current.preview('300.00') })

    await act(async () => { await result.current.apply() })

    expect(post).toHaveBeenLastCalledWith('/accounts/acc-1/initial-balance', { initialBalance: '300.00' })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(showNotice).toHaveBeenCalledWith(expect.stringContaining('$250.00 to $300.00'))
    expect(result.current.fixing).toBeNull()
    expect(status.begin).toHaveBeenCalled()
    expect(status.end).toHaveBeenCalled()
  })

  it('does nothing on Apply before a preview has arrived', async () => {
    const post = vi.spyOn(api, 'post')
    const { result } = setup()
    act(() => result.current.open(makeAccount()))

    await act(async () => { await result.current.apply() })

    expect(post).not.toHaveBeenCalled()
  })

  it('reports a failed apply beside Apply and stays open', async () => {
    vi.spyOn(api, 'post')
      .mockResolvedValueOnce(previewFor('300.00'))
      .mockRejectedValueOnce(new Error('Server said no'))
    const { result, status, reload } = setup()
    act(() => result.current.open(makeAccount()))
    await act(async () => { await result.current.preview('300.00') })

    await act(async () => { await result.current.apply() })

    expect(result.current.errors.form).toBe('Server said no')
    expect(status.show).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(result.current.fixing).not.toBeNull()
    expect(status.end).toHaveBeenCalled()
  })
})
