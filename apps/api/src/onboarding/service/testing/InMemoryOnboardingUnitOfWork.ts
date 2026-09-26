import type { Category } from '../../../db/models/index.js'
import type { Repositories } from '../../../data/Repositories.js'
import type { UnitOfWork } from '../../../data/UnitOfWork.js'
import type { CategoryRepository } from '../../../categories/repository/CategoryRepository.js'
import type { OnboardingRepository } from '../../repository/OnboardingRepository.js'

/** The state the fake holds: one user's setup flag, their categories, and which category ids are referenced. */
export interface FakeOnboardingState {
  onboardedAt: Date | null
  situations: string[]
  categories: Array<{ id: string; slug: string; name: string; parent_id: string | null }>
  inUse: Set<string>
}

/**
 * A {@link UnitOfWork} over one in-memory user.
 *
 * Like a database transaction it is atomic: if the callback throws, every
 * change it made is discarded. Only the categories and onboarding
 * repositories exist; touching any other one fails the test loudly.
 */
export class InMemoryOnboardingUnitOfWork implements UnitOfWork {
  /** The state under test; assertions read it directly. */
  state: FakeOnboardingState = { onboardedAt: null, situations: [], categories: [], inUse: new Set() }

  /** When set, marking the user onboarded fails with this error, to prove the wider unit of work rolls back. */
  failMarkOnboarded: Error | undefined

  /** When true the user has no row, as after the account was deleted. */
  userMissing = false

  private seq = 0

  /** @inheritdoc */
  async forUser<T>(_userId: string, work: (repos: Repositories) => Promise<T>): Promise<T> {
    const before = structuredClone(this.state)
    try {
      return await work(this.repositories())
    } catch (error) {
      this.state = before
      throw error
    }
  }

  /** @inheritdoc */
  forSystem<T>(): Promise<T> {
    return Promise.reject(new Error('forSystem is not used by onboarding.'))
  }

  private repositories(): Repositories {
    const onboarding: OnboardingRepository = {
      findState: async () => this.userMissing ? undefined : ({ onboarded_at: this.state.onboardedAt, onboarding_situations: this.state.situations }),
      countCategories: async () => this.state.categories.length,
      markOnboarded: async (_userId, situations) => {
        if (this.failMarkOnboarded !== undefined) throw this.failMarkOnboarded
        this.state.onboardedAt = new Date('2026-03-01T00:00:00Z')
        this.state.situations = [...situations]
      },
      clear: async () => {
        this.state.onboardedAt = null
        this.state.situations = []
      },
    }
    const categories: Partial<CategoryRepository> = {
      listSummaries: async () => this.state.categories.map((c) => ({ ...c })),
      insert: async (input) => {
        const id = `cat-${++this.seq}`
        this.state.categories.push({ id, slug: input.slug, name: input.name, parent_id: input.parentId })
        return { id, slug: input.slug, name: input.name, parent_id: input.parentId } as Category
      },
      findIdsInUse: async (ids) => new Set(ids.filter((id) => this.state.inUse.has(id))),
      delete: async (id) => {
        const before = this.state.categories.length
        this.state.categories = this.state.categories.filter((c) => c.id !== id)
        return this.state.categories.length < before
      },
    }
    return { onboarding, categories } as Partial<Repositories> as Repositories
  }
}
