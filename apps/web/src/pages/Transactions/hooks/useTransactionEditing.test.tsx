import { act, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider, ToastViewport } from '@wickermoney/ui-kit'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/ApiError.js'
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

const SNAP = { undo: { id: 'snap-1', expiresAt: '2026-11-24T12:10:00.000Z', kind: 'transaction' } }

describe('Undo of a delete (ADR 0016)', () => {
  const confirmYes = () => vi.spyOn(window, 'confirm').mockReturnValue(true)
  const RESTORED = { restored: 1, relinkedMatch: false, restoredDismissals: 0, skippedDismissals: 0 }

  it('asks the server to keep a copy and offers Undo when it did', async () => {
    confirmYes()
    const del = vi.spyOn(api, 'del').mockResolvedValue(SNAP)
    const { hook } = editing()

    await act(() => hook.result.current.remove(makeTransaction({ id: 't-9' })))

    expect(del).toHaveBeenCalledWith('/transactions/t-9?undo=1')
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('offers no Undo when the server kept nothing (null) or is older (204)', async () => {
    confirmYes()
    const del = vi.spyOn(api, 'del').mockResolvedValue({ undo: null })
    const { hook } = editing()

    await act(() => hook.result.current.remove(makeTransaction()))
    await waitFor(() => { expect(shownToasts()).toEqual(["Deleted 'Coffee' (-$4.50)."]) })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()

    del.mockResolvedValue(undefined)
    await act(() => hook.result.current.remove(makeTransaction({ merchant: 'Bagel', amount: '-3.00' })))
    await waitFor(() => { expect(shownToasts()).toEqual(["Deleted 'Bagel' (-$3.00)."]) })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('restores the snapshot, says Restored, and re-reads the list', async () => {
    confirmYes()
    vi.spyOn(api, 'del').mockResolvedValue(SNAP)
    const post = vi.spyOn(api, 'post').mockResolvedValue(RESTORED)
    const onChanged = vi.fn(async () => {})
    const status = makeStatus()
    const hook = renderHook(() => useTransactionEditing(status, onChanged), { wrapper: Toasts })

    await act(() => hook.result.current.remove(makeTransaction({ merchant: 'Coffee', amount: '-4.50' })))
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() => { expect(shownToasts()).toEqual(["Restored 'Coffee' (-$4.50)."]) })
    expect(post).toHaveBeenCalledWith('/transaction-undos/snap-1/restore')
    expect(onChanged).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('says both sides of a transfer were put back', async () => {
    confirmYes()
    vi.spyOn(api, 'del').mockResolvedValue({ undo: { ...SNAP.undo, kind: 'transfer' } })
    vi.spyOn(api, 'post').mockResolvedValue({ ...RESTORED, restored: 2 })
    const { hook } = editing('tr-1')

    await act(() => hook.result.current.remove(makeTransaction({ transfer_id: 'tr-1', amount: '-50.00' })))
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() => { expect(shownToasts()).toEqual(['Restored transfer of $50.00. Both sides were put back.']) })
  })

  it('keeps each delete\'s own Undo: two deletes restore their own snapshots', async () => {
    confirmYes()
    const del = vi.spyOn(api, 'del')
    del.mockResolvedValueOnce(SNAP).mockResolvedValueOnce({ undo: { ...SNAP.undo, id: 'snap-2' } })
    const post = vi.spyOn(api, 'post').mockResolvedValue(RESTORED)
    const { hook } = editing()

    await act(() => hook.result.current.remove(makeTransaction({ merchant: 'Coffee' })))
    await act(() => hook.result.current.remove(makeTransaction({ merchant: 'Bagel', amount: '-3.00' })))
    const buttons = await screen.findAllByRole('button', { name: 'Undo' })
    expect(buttons).toHaveLength(2)
    await userEvent.click(buttons[0]!)

    await waitFor(() => { expect(post).toHaveBeenCalledWith('/transaction-undos/snap-2/restore') })
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('says it is too late when the snapshot expired (410), in place of the Undo toast', async () => {
    confirmYes()
    vi.spyOn(api, 'del').mockResolvedValue(SNAP)
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError('Gone.', 410, 'undo_expired'))
    const { hook } = editing()

    await act(() => hook.result.current.remove(makeTransaction()))
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() => { expect(shownToasts()).toEqual(['Error: It is too late to undo that.']) })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it.each([
    [404, 'not_found', 'Nothing to undo.'],
    [409, 'undo_unavailable', 'The account was deleted since.'],
  ])('shows the server\'s own words for a %i', async (status, code, message) => {
    confirmYes()
    vi.spyOn(api, 'del').mockResolvedValue(SNAP)
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(message, status, code))
    const { hook } = editing()

    await act(() => hook.result.current.remove(makeTransaction()))
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() => { expect(shownToasts()).toEqual([`Error: ${message}`]) })
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
