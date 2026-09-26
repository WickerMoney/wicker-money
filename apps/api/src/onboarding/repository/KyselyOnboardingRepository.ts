import type { Trx } from '../../db/Trx.js'
import type { OnboardingRepository } from './OnboardingRepository.js'
import type { OnboardingState } from './OnboardingState.js'

/** Kysely implementation of {@link OnboardingRepository} over a single transaction. */
export class KyselyOnboardingRepository implements OnboardingRepository {
  /** @param trx - The transaction all queries run on. */
  constructor(protected readonly trx: Trx) {}

  /** @inheritdoc */
  findState(userId: string): Promise<OnboardingState | undefined> {
    return this.trx
      .selectFrom('core.users')
      .select(['onboarded_at', 'onboarding_situations'])
      .where('id', '=', userId)
      .executeTakeFirst()
  }

  /** @inheritdoc */
  async countCategories(): Promise<number> {
    const row = await this.trx
      .selectFrom('core.categories')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
    return Number(row.count)
  }

  /** @inheritdoc */
  async markOnboarded(userId: string, situations: readonly string[]): Promise<void> {
    await this.trx
      .updateTable('core.users')
      .set({ onboarded_at: new Date(), onboarding_situations: [...situations], updated_at: new Date() })
      .where('id', '=', userId)
      .execute()
  }

  /** @inheritdoc */
  async clear(userId: string): Promise<void> {
    await this.trx
      .updateTable('core.users')
      .set({ onboarded_at: null, onboarding_situations: [], updated_at: new Date() })
      .where('id', '=', userId)
      .execute()
  }
}
