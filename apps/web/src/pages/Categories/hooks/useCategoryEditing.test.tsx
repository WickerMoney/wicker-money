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
