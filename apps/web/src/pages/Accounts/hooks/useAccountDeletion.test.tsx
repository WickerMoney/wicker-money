import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import type { AccountUsage, MigrationPlan } from '../../../models/index.js'
import { deferred } from '../../../testing/deferred.js'
import { makeAccount } from '../../../testing/makeAccount.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { useAccountDeletion } from './useAccountDeletion.js'

const target = makeAccount({ id: 'acc-2', name: 'Savings' })
const doomed = makeAccount({ id: 'acc-1', name: 'Checking' })
const archived = makeAccount({ id: 'acc-3', name: 'Old', archivedAt: '2025-01-01T00:00:00Z' })

const noUsage: AccountUsage = { total: 0, by: [], unreadable: [] }
const usage: AccountUsage = {
  total: 45, unreadable: [],
  by: [{ table: 'core.transactions', count: 42 }, { table: 'core.recurring_items', count: 3 }],
}
const plan: MigrationPlan = {
  removedTransferTransactions: 0, removedTransferRecurringItems: 0,
  movedTransactions: 42, movedRecurringItems: 3, totalAffected: 45,
}

function setup() {
  const status = makeStatus()
  const reload = vi.fn(async () => {})
  const showNotice = vi.fn()
  const hook = renderHook(() =>
    useAccountDeletion(status, [doomed, target, archived], reload, showNotice))
  return { ...hook, status, reload, showNotice }
}

let confirm: ReturnType<typeof vi.spyOn>

beforeEach(() => { confirm = vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => { vi.restoreAllMocks() })

describe('starting a delete', () => {
  it('deletes at once, after confirming, when nothing uses the account', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(noUsage)
    const del = vi.spyOn(api, 'del').mockResolvedValue(undefined)
    const { result, reload } = setup()

    await act(async () => { await result.current.startDelete(doomed) })

    expect(get).toHaveBeenCalledWith('/accounts/acc-1/usage')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(del).toHaveBeenCalledWith('/accounts/acc-1')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(result.current.resolving).toBeNull()
  })

  it('deletes nothing when the user cancels the confirmation', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(noUsage)
    const del = vi.spyOn(api, 'del')
    confirm.mockReturnValue(false)
    const { result, reload } = setup()

    await act(async () => { await result.current.startDelete(doomed) })

    expect(del).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('opens the resolution panel instead of deleting when the account has history', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(usage)
    const del = vi.spyOn(api, 'del')
    const { result } = setup()

    await act(async () => { await result.current.startDelete(doomed) })

    expect(del).not.toHaveBeenCalled()
    expect(result.current.resolving).toEqual({ account: doomed, usage })
    // The account itself and archived accounts are not offered as move targets.
    expect(result.current.migrateTargets.map((a) => a.id)).toEqual(['acc-2'])
  })

  it('reports a failed usage check through the status', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('down'))
    const { result, status } = setup()

    await act(async () => { await result.current.startDelete(doomed) })

    expect(status.show).toHaveBeenCalledWith('down')
    expect(status.end).toHaveBeenCalled()
  })
})

describe('resolving a delete that has history', () => {
  async function resolving() {
    vi.spyOn(api, 'get').mockResolvedValue(usage)
    const ctx = setup()
    await act(async () => { await ctx.result.current.startDelete(doomed) })
    return ctx
  }

  it('closes the panel and forgets a preview on cancel', async () => {
    const { result } = await resolving()

    act(() => result.current.dismiss())

    expect(result.current.resolving).toBeNull()
    expect(result.current.migratePlan).toBeNull()
  })

  it('deletes with history, sending the usage total as the confirm count', async () => {
    const { result, reload, showNotice } = await resolving()
    const post = vi.spyOn(api, 'post').mockResolvedValue({ deletedTransactions: 42, deletedRecurringItems: 1 })

    await act(async () => { await result.current.deleteWithHistory() })

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('42 transactions and 3 recurring items'))
    expect(post).toHaveBeenCalledWith('/accounts/acc-1/delete-with-history', { confirmCount: 45 })
    expect(reload).toHaveBeenCalled()
    expect(showNotice).toHaveBeenCalledWith(
      "Deleted 'Checking', 42 transactions and 1 recurring item with it.",
    )
    expect(result.current.resolving).toBeNull()
  })

  it('does not delete the history when the user declines', async () => {
    const { result } = await resolving()
    const post = vi.spyOn(api, 'post')
    confirm.mockReturnValue(false)

    await act(async () => { await result.current.deleteWithHistory() })

    expect(post).not.toHaveBeenCalled()
    expect(result.current.resolving).not.toBeNull()
  })

  it('keeps the panel open and shows the message on a 409 from delete-with-history', async () => {
    const { result, status, reload } = await resolving()
    vi.spyOn(api, 'post').mockRejectedValue(
      Object.assign(new Error('The account changed; the count no longer matches'), { status: 409 }),
    )

    await act(async () => { await result.current.deleteWithHistory() })

    expect(status.show).toHaveBeenCalledWith('The account changed; the count no longer matches')
    expect(reload).not.toHaveBeenCalled()
    expect(result.current.resolving).not.toBeNull()
    expect(status.end).toHaveBeenCalled()
  })

  it('previews a move to the chosen account', async () => {
    const { result } = await resolving()
    const post = vi.spyOn(api, 'post').mockResolvedValue(plan)
    act(() => result.current.chooseTarget('acc-2'))

    await act(async () => { await result.current.previewMigrate() })

    expect(post).toHaveBeenCalledWith(
      '/accounts/acc-1/migrate/preview', { toAccountId: 'acc-2' }, expect.anything(),
    )
    expect(result.current.migratePlan).toEqual(plan)
  })

  it('needs a target before it previews', async () => {
    const { result } = await resolving()
    const post = vi.spyOn(api, 'post')

    await act(async () => { await result.current.previewMigrate() })

    expect(post).not.toHaveBeenCalled()
  })

  it('discards a preview when a different target is chosen, even one still in flight', async () => {
    const { result } = await resolving()
    const pending = deferred<MigrationPlan>()
    vi.spyOn(api, 'post').mockReturnValue(pending.promise)
    act(() => result.current.chooseTarget('acc-2'))
    let p: Promise<void> = Promise.resolve()
    act(() => { p = result.current.previewMigrate() })

    act(() => result.current.chooseTarget(''))
    await act(async () => { pending.resolve(plan); await p })

    expect(result.current.migratePlan).toBeNull()
  })

  it('moves the history with the previewed count as the confirm count', async () => {
    const { result, reload, showNotice } = await resolving()
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce(plan).mockResolvedValueOnce({})
    act(() => result.current.chooseTarget('acc-2'))
    await act(async () => { await result.current.previewMigrate() })

    await act(async () => { await result.current.commitMigrate() })

    expect(post).toHaveBeenLastCalledWith('/accounts/acc-1/migrate', { toAccountId: 'acc-2', confirmCount: 45 })
    expect(reload).toHaveBeenCalled()
    expect(showNotice).toHaveBeenCalledWith("Moved 'Checking''s history into 'Savings' and deleted 'Checking'.")
    expect(result.current.resolving).toBeNull()
  })

  it('will not commit a move that was not previewed', async () => {
    const { result } = await resolving()
    const post = vi.spyOn(api, 'post')
    act(() => result.current.chooseTarget('acc-2'))

    await act(async () => { await result.current.commitMigrate() })

    expect(post).not.toHaveBeenCalled()
  })
})

describe('archiving', () => {
  it('archives, reloads and says what happened', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({})
    const { result, reload, showNotice } = setup()

    await act(async () => { await result.current.archive(doomed) })

    expect(post).toHaveBeenCalledWith('/accounts/acc-1/archive', {})
    expect(reload).toHaveBeenCalled()
    expect(showNotice).toHaveBeenLastCalledWith(expect.stringContaining("'Checking' is archived"))
  })

  it('reports a failure through the status', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new Error('nope'))
    const { result, status } = setup()

    await act(async () => { await result.current.archive(doomed) })

    expect(status.show).toHaveBeenCalledWith('nope')
  })
})
