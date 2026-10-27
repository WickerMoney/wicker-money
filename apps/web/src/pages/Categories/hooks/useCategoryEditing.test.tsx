import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import { makeCategory } from '../../../testing/makeCategory.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { ToastsWrapper, findToast, toastTexts } from '../../../testing/toastTexts.js'
import { validationFailed } from '../../../testing/validationFailed.js'
import { useCategoryEditing } from './useCategoryEditing.js'

afterEach(() => { vi.restoreAllMocks() })

function editing() {
  const status = makeStatus()
  const hook = renderHook(() => useCategoryEditing(status, async () => {}), { wrapper: ToastsWrapper })
  act(() => hook.result.current.start(makeCategory({ id: 'cat-1', name: 'Food' })))
  return { hook, status }
}

describe('renaming a category inline', () => {
  it('refuses a blank name on the name, without sending it', async () => {
    const patch = vi.spyOn(api, 'patch')
    const { hook } = editing()

    act(() => hook.result.current.change({ ...hook.result.current.editing!, name: '   ' }))
    await act(() => hook.result.current.save())

    expect(hook.result.current.errors.fields).toEqual({ name: 'This cannot be empty.' })
    expect(patch).not.toHaveBeenCalled()
  })

  it("puts the server's issue on the name, and a re-parent refusal beside Save", async () => {
    vi.spyOn(api, 'patch').mockRejectedValueOnce(validationFailed([['name'], 'Must be 100 characters or fewer.']))
    const { hook, status } = editing()

    await act(() => hook.result.current.save())
    expect(hook.result.current.errors.fields).toEqual({ name: 'Must be 100 characters or fewer.' })

    vi.spyOn(api, 'patch').mockRejectedValueOnce(validationFailed([[], 'A category cannot be its own parent.']))
    await act(() => hook.result.current.save())
    expect(hook.result.current.errors).toEqual({ fields: {}, form: 'A category cannot be its own parent.' })
    expect(status.show).not.toHaveBeenCalled()
    expect(toastTexts()).toEqual([])
  })

  it('says what was saved in a toast', async () => {
    vi.spyOn(api, 'patch').mockResolvedValue({})
    const { hook } = editing()
    act(() => hook.result.current.change({ ...hook.result.current.editing!, name: ' Groceries ' }))

    await act(() => hook.result.current.save())

    expect(await findToast()).toEqual(["Saved changes to 'Groceries'."])
  })
})

describe('disabling, enabling and deleting', () => {
  const food = makeCategory({ id: 'cat-1', name: 'Food' })

  it('says what a disable and an enable did, in one replaceable toast', async () => {
    vi.spyOn(api, 'patch').mockResolvedValue({})
    const { hook } = editing()

    await act(() => hook.result.current.setEnabled(food, false))
    expect(await findToast("Disabled 'Food'.")).toHaveLength(1)

    await act(() => hook.result.current.setEnabled(food, true))
    expect(await findToast("Enabled 'Food'.")).toEqual(["Enabled 'Food'. It is back in the pickers."])
  })

  it('reports a refused disable in an error toast, not the page banner', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(new Error('nope'))
    const { hook, status } = editing()

    await act(() => hook.result.current.setEnabled(food, false))

    expect(await findToast()).toEqual(['Error: nope'])
    expect(status.show).not.toHaveBeenCalled()
  })

  it('names what was deleted', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ total: 0, by: [], unreadable: [] })
    vi.spyOn(api, 'del').mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { hook } = editing()

    await act(() => hook.result.current.remove(food))

    expect(await findToast()).toEqual(["Deleted category 'Food'."])
  })

  it('explains in an error toast why a category in use cannot be deleted, and deletes nothing', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ total: 3, by: [], unreadable: [] })
    const del = vi.spyOn(api, 'del')
    const { hook, status } = editing()

    await act(() => hook.result.current.remove(food))

    expect(await findToast("'Food' is still in use")).toHaveLength(1)
    expect(toastTexts()[0]).toMatch(/^Error: /)
    expect(del).not.toHaveBeenCalled()
    expect(status.show).not.toHaveBeenCalled()
  })

  it('stays quiet when the delete is declined', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ total: 0, by: [], unreadable: [] })
    const del = vi.spyOn(api, 'del')
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { hook } = editing()

    await act(() => hook.result.current.remove(food))

    expect(del).not.toHaveBeenCalled()
    expect(toastTexts()).toEqual([])
  })
})

describe('moving a category under a parent', () => {
  it('reports the parent it was saved under, so the page can open it', async () => {
    vi.spyOn(api, 'patch').mockResolvedValue({})
    const onMovedUnder = vi.fn()
    const hook = renderHook(() => useCategoryEditing(makeStatus(), async () => {}, onMovedUnder), { wrapper: ToastsWrapper })
    act(() => hook.result.current.start(makeCategory({ id: 'kid', name: 'Dining', parent_id: null })))
    act(() => hook.result.current.change({ ...hook.result.current.editing!, parentId: 'food' }))

    await act(() => hook.result.current.save())

    expect(onMovedUnder).toHaveBeenCalledWith('food')
  })

  it('reports nothing for a top-level category, or a save that failed', async () => {
    const onMovedUnder = vi.fn()
    const hook = renderHook(() => useCategoryEditing(makeStatus(), async () => {}, onMovedUnder), { wrapper: ToastsWrapper })
    act(() => hook.result.current.start(makeCategory({ id: 'a', name: 'Food', parent_id: null })))
    vi.spyOn(api, 'patch').mockResolvedValueOnce({})
    await act(() => hook.result.current.save())

    act(() => hook.result.current.start(makeCategory({ id: 'b', name: 'Kid', parent_id: 'food' })))
    vi.spyOn(api, 'patch').mockRejectedValueOnce(validationFailed([[], 'Refused.']))
    await act(() => hook.result.current.save())

    expect(onMovedUnder).not.toHaveBeenCalled()
  })
})
