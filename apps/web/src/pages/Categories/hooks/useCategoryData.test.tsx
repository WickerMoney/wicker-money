import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import type { Category, Rule } from '../../../models/index.js'
import type { OnboardingValue } from '../../../onboarding/OnboardingValue.js'
import { deferred } from '../../../testing/deferred.js'
import { makeCategory } from '../../../testing/makeCategory.js'
import { makeStatus } from '../../../testing/makeStatus.js'

let onboarding: OnboardingValue['status']

vi.mock('../../../onboarding/useOnboarding.js', () => ({
  useOnboarding: () => ({ status: onboarding }),
}))

const { useCategoryData } = await import('./useCategoryData.js')

const rule: Rule = { id: 'r1', category_id: 'cat-1', priority: 1, conditions: [] }

/** Routes GETs by path so each test can vary what each endpoint returns. */
function serve(cats: Category[], rules: Rule[]) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
    (path === '/categories' ? cats : rules) as never)
}

function setup() {
  const status = makeStatus()
  const hook = renderHook(() => useCategoryData(status))
  return { ...hook, status }
}

beforeEach(() => { onboarding = null })
afterEach(() => { vi.restoreAllMocks() })

describe('useCategoryData', () => {
  it('loads categories and rules together', async () => {
    const get = serve([makeCategory()], [rule])
    const { result } = setup()

    expect(result.current.categories).toBeNull()
    await waitFor(() => { expect(result.current.categories).toHaveLength(1) })

    expect(result.current.rules).toEqual([rule])
    expect(get).toHaveBeenCalledWith('/categories', expect.anything())
    expect(get).toHaveBeenCalledWith('/category-rules', expect.anything())
  })

  it('reports a failed load through the status', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('down'))
    const { status } = setup()

    await waitFor(() => { expect(status.show).toHaveBeenCalledWith('down') })
  })

  it('uses a generic message when the failure is not an Error', async () => {
    vi.spyOn(api, 'get').mockRejectedValue('boom')
    const { status } = setup()

    await waitFor(() => { expect(status.show).toHaveBeenCalledWith('Could not load categories.') })
  })

  it('re-reads on demand', async () => {
    const get = serve([makeCategory()], [])
    const { result } = setup()
    await waitFor(() => { expect(result.current.categories).toHaveLength(1) })
    serve([makeCategory(), makeCategory({ id: 'cat-2', slug: 'rent', name: 'Rent' })], [rule])

    await act(async () => { await result.current.reload() })

    expect(result.current.categories).toHaveLength(2)
    expect(result.current.rules).toEqual([rule])
    expect(get).toHaveBeenCalled()
  })

  it('reloads when the setup wizard changes what exists', async () => {
    onboarding = { onboardedAt: null, situations: [], categoryCount: 0, groups: [] }
    const get = serve([], [])
    const { result, rerender } = setup()
    await waitFor(() => { expect(result.current.categories).toEqual([]) })
    const before = get.mock.calls.length
    serve([makeCategory()], [])

    onboarding = { onboardedAt: '2026-01-01T00:00:00Z', situations: [], categoryCount: 61, groups: [] }
    rerender()

    await waitFor(() => { expect(result.current.categories).toHaveLength(1) })
    expect(get.mock.calls.length).toBeGreaterThan(before)
  })

  it('ignores a response that a newer load has superseded', async () => {
    const stale = deferred<Category[]>()
    const get = vi.spyOn(api, 'get')
    get.mockImplementationOnce(() => stale.promise as never)
    get.mockImplementationOnce(async () => [] as never)
    const { result } = setup()

    serve([makeCategory({ name: 'Fresh' })], [])
    await act(async () => { await result.current.reload() })
    await act(async () => { stale.resolve([makeCategory({ name: 'Stale' })]) })

    expect(result.current.categories?.map((c) => c.name)).toEqual(['Fresh'])
  })
})
