import { act, renderHook, waitFor } from '@testing-library/react'
import { ToastProvider, ToastViewport } from '@wickermoney/ui-kit'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { makeTransaction } from '../../../testing/makeTransaction.js'
import { shownToasts } from '../../../testing/shownToasts.js'
import { validationFailed } from '../../../testing/validationFailed.js'
import { useTransactionEditing } from './useTransactionEditing.js'

afterEach(() => { vi.restoreAllMocks() })

/** The provider and the banner, so what the hook says can be read off the screen. */
function Toasts({ children }: { readonly children: ReactNode }) {
  return <ToastProvider><ToastViewport />{children}</ToastProvider>
}

function editing(transferId: string | null = null) {
  const status = makeStatus()
  const hook = renderHook(() => useTransactionEditing(status, async () => {}), { wrapper: Toasts })
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

describe('what a row action says', () => {
  const confirmYes = () => vi.spyOn(window, 'confirm').mockReturnValue(true)

  it('names the transaction that was deleted and its amount, and replaces the last delete', async () => {
    confirmYes()
    vi.spyOn(api, 'del').mockResolvedValue(undefined)
    const { hook } = editing()

    await act(() => hook.result.current.remove(makeTransaction({ merchant: 'Coffee', amount: '-4.50' })))
    await waitFor(() => { expect(shownToasts()).toEqual(["Deleted 'Coffee' (-$4.50)."]) })

    await act(() => hook.result.current.remove(makeTransaction({ merchant: 'Bagel', amount: '-3.00' })))
    await waitFor(() => { expect(shownToasts()).toEqual(["Deleted 'Bagel' (-$3.00)."]) })
  })

  it('says both sides of a transfer were removed, whichever leg was clicked', async () => {
    confirmYes()
    vi.spyOn(api, 'del').mockResolvedValue(undefined)
    const { hook } = editing()

    await act(() => hook.result.current.remove(makeTransaction({ transfer_id: 'tr-1', amount: '-50.00' })))

    await waitFor(() => { expect(shownToasts()).toEqual(['Deleted transfer of $50.00. Both sides were removed.']) })
  })

  it('says nothing when the person backs out of the confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const del = vi.spyOn(api, 'del')
    const { hook } = editing()

    await act(() => hook.result.current.remove(makeTransaction()))

    expect(del).not.toHaveBeenCalled()
    expect(shownToasts()).toEqual([])
  })

  it('reports a refused delete as an error toast, not in the page banner', async () => {
    confirmYes()
    vi.spyOn(api, 'del').mockRejectedValue(new Error('That transaction is locked.'))
    const { hook, status } = editing()

    await act(() => hook.result.current.remove(makeTransaction()))

    await waitFor(() => { expect(shownToasts()).toEqual(['Error: That transaction is locked.']) })
    expect(status.show).not.toHaveBeenCalled()
  })

  it('says the transaction was updated once the edit dialog is gone', async () => {
    vi.spyOn(api, 'patch').mockResolvedValue({})
    const { hook } = editing()

    await act(() => hook.result.current.save())

    expect(hook.result.current.editing).toBeNull()
    await waitFor(() => { expect(shownToasts()).toEqual(["Updated 'Coffee'."]) })
  })

  it('names the category a row was set to, or says it was cleared', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ updated: 1 })
    const { hook } = editing()
    const t = makeTransaction({ merchant: 'Coffee' })

    await act(() => hook.result.current.assign(t, 'cat-1', 'Groceries'))
    await waitFor(() => { expect(shownToasts()).toEqual(["Set 'Coffee' to Groceries."]) })

    await act(() => hook.result.current.assign(t, '', ''))
    await waitFor(() => { expect(shownToasts()).toEqual(["Cleared the category of 'Coffee'."]) })
  })

  it('reports a refused category change as an error toast', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new Error('Category not found.'))
    const { hook, status } = editing()

    await act(() => hook.result.current.assign(makeTransaction(), 'cat-9', 'Gone'))

    await waitFor(() => { expect(shownToasts()).toEqual(['Error: Category not found.']) })
    expect(status.show).not.toHaveBeenCalled()
  })
})
