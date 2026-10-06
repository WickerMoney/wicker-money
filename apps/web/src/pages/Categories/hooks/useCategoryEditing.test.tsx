import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import { makeCategory } from '../../../testing/makeCategory.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { validationFailed } from '../../../testing/validationFailed.js'
import { useCategoryEditing } from './useCategoryEditing.js'

afterEach(() => { vi.restoreAllMocks() })

function editing() {
  const status = makeStatus()
  const hook = renderHook(() => useCategoryEditing(status, async () => {}))
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
  })
})

describe('moving a category under a parent', () => {
  it('reports the parent it was saved under, so the page can open it', async () => {
    vi.spyOn(api, 'patch').mockResolvedValue({})
    const onMovedUnder = vi.fn()
    const hook = renderHook(() => useCategoryEditing(makeStatus(), async () => {}, onMovedUnder))
    act(() => hook.result.current.start(makeCategory({ id: 'kid', name: 'Dining', parent_id: null })))
    act(() => hook.result.current.change({ ...hook.result.current.editing!, parentId: 'food' }))

    await act(() => hook.result.current.save())

    expect(onMovedUnder).toHaveBeenCalledWith('food')
  })

  it('reports nothing for a top-level category, or a save that failed', async () => {
    const onMovedUnder = vi.fn()
    const hook = renderHook(() => useCategoryEditing(makeStatus(), async () => {}, onMovedUnder))
    act(() => hook.result.current.start(makeCategory({ id: 'a', name: 'Food', parent_id: null })))
    vi.spyOn(api, 'patch').mockResolvedValueOnce({})
    await act(() => hook.result.current.save())

    act(() => hook.result.current.start(makeCategory({ id: 'b', name: 'Kid', parent_id: 'food' })))
    vi.spyOn(api, 'patch').mockRejectedValueOnce(validationFailed([[], 'Refused.']))
    await act(() => hook.result.current.save())

    expect(onMovedUnder).not.toHaveBeenCalled()
  })
})
