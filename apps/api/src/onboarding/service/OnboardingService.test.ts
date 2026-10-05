import { beforeEach, describe, expect, it } from 'vitest'
import { SITUATION_GROUPS, selectForSituations } from '../../categories/catalog.js'
import { NotFoundError } from '../../errors.js'
import { OnboardingService } from './OnboardingService.js'
import { InMemoryOnboardingUnitOfWork } from './testing/InMemoryOnboardingUnitOfWork.js'
import { withAlways } from './withAlways.js'

const USER = 'user-1'

let uow: InMemoryOnboardingUnitOfWork
let service: OnboardingService

beforeEach(() => {
  uow = new InMemoryOnboardingUnitOfWork()
  service = new OnboardingService(uow)
})

describe('withAlways', () => {
  it('puts the always-on situation first and never repeats it', () => {
    expect(withAlways([])).toEqual(['always'])
    expect(withAlways(['pets', 'always', 'kids'])).toEqual(['always', 'pets', 'kids'])
  })
})

describe('getStatus', () => {
  it('reports a new account as not set up, with the catalog questions', async () => {
    const status = await service.getStatus(USER)
    expect(status).toMatchObject({ onboardedAt: null, situations: [], categoryCount: 0 })
    expect(status.groups).toBe(SITUATION_GROUPS)
  })

  it('returns the completion time as an ISO string and drops situations the catalog no longer knows', async () => {
    uow.state.onboardedAt = new Date('2026-03-01T10:00:00Z')
    uow.state.situations = ['pets', 'renamed-in-a-later-release']
    expect(await service.getStatus(USER)).toMatchObject({
      onboardedAt: '2026-03-01T10:00:00.000Z',
      situations: ['pets'],
    })
  })

  it('fails for a user that no longer exists', async () => {
    uow.userMissing = true
    await expect(service.getStatus(USER)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('preview', () => {
  it('counts exactly what completing the same answers would create', async () => {
    const preview = service.preview(['pets'])
    const created = await service.complete(USER, ['pets'])
    expect(preview.total).toBe(created.created)
    expect(preview.slugs).toEqual(selectForSituations(['always', 'pets']).map((e) => e.slug))
    expect(preview.parents).toBeLessThan(preview.total)
  })

  it('always includes the always-on categories, and writes nothing', () => {
    expect(service.preview([]).total).toBeGreaterThan(0)
    expect(uow.state.categories).toEqual([])
  })
})

describe('complete', () => {
  it('creates the starter categories and records the answers with always first', async () => {
    const result = await service.complete(USER, ['pets'])
    expect(result).toMatchObject({ onboarded: true, skipped: 0, situations: ['always', 'pets'] })
    expect(uow.state.categories).toHaveLength(result.created)
    expect(uow.state.situations).toEqual(['always', 'pets'])
    expect(uow.state.onboardedAt).not.toBeNull()
  })

  it('is idempotent: a second run adds nothing', async () => {
    const first = await service.complete(USER, ['pets'])
    const second = await service.complete(USER, ['pets'])
    expect(second.created).toBe(0)
    expect(second.skipped).toBe(first.created)
    expect(uow.state.categories).toHaveLength(first.created)
  })

  it('adds only entries the catalog gained since the last run, and leaves renamed ones alone', async () => {
    // An install set up before Memberships and Domains / web hosting existed:
    // simulate it by removing those two after a full run.
    await service.complete(USER, ['tech'])
    uow.state.categories = uow.state.categories.filter(
      (c) => c.slug !== 'memberships' && c.slug !== 'domains-web-hosting',
    )
    const before = uow.state.categories.length
    const groceries = uow.state.categories.find((c) => c.slug === 'groceries')
    if (groceries === undefined) throw new Error('expected groceries in the starter set')
    groceries.name = 'Food shopping'

    await service.reset(USER, false)
    const again = await service.complete(USER, ['tech'])

    expect(again.created).toBe(2)
    expect(again.skipped).toBe(before)
    expect(uow.state.categories).toHaveLength(before + 2)
    expect(uow.state.categories.find((c) => c.slug === 'groceries')?.name).toBe('Food shopping')
  })

  it('is atomic: if recording the answers fails, no category is left behind', async () => {
    uow.failMarkOnboarded = new Error('database went away')
    await expect(service.complete(USER, ['pets'])).rejects.toThrow('database went away')
    expect(uow.state.categories).toEqual([])
    expect(uow.state.onboardedAt).toBeNull()
  })
})

describe('reset', () => {
  it('clears the flag and answers but keeps every category by default', async () => {
    const done = await service.complete(USER, ['pets'])
    const result = await service.reset(USER, false)
    expect(result).toEqual({ onboarded: false, removed: 0, kept: [] })
    expect(uow.state).toMatchObject({ onboardedAt: null, situations: [] })
    expect(uow.state.categories).toHaveLength(done.created)
  })

  it('removes unused starter categories on request and keeps those in use', async () => {
    await service.complete(USER, [])
    const total = uow.state.categories.length
    const pinned = uow.state.categories.find((c) => c.parent_id === null)
    if (pinned === undefined) throw new Error('expected a top-level starter category')
    uow.state.inUse.add(pinned.id)

    const result = await service.reset(USER, true)

    expect(result.onboarded).toBe(false)
    expect(result.kept).toContain(pinned.name)
    expect(result.removed).toBe(total - uow.state.categories.length)
    expect(uow.state.categories.some((c) => c.id === pinned.id)).toBe(true)
  })
})
