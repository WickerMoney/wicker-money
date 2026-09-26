import { SITUATION_GROUPS, isSituation, selectForSituations, type Situation } from '../../categories/catalog.js'
import { createStarterCategories } from '../../categories/service/createStarterCategories.js'
import { removeUnusedStarterCategories } from '../../categories/service/removeUnusedStarterCategories.js'
import type { UnitOfWork } from '../../data/UnitOfWork.js'
import { NotFoundError } from '../../errors.js'
import type { OnboardingPreview } from './OnboardingPreview.js'
import type { OnboardingResetResult } from './OnboardingResetResult.js'
import type { OnboardingResult } from './OnboardingResult.js'
import type { OnboardingStatus } from './OnboardingStatus.js'
import { withAlways } from './withAlways.js'

/**
 * Setup wizard: previews and applies the starter category set.
 *
 * The state lives on the user row rather than in the browser. Browser storage
 * would be simpler and wrong in both directions: the wizard would reappear on
 * every new device, and clearing site data would re-offer a setup whose
 * categories already exist.
 */
export class OnboardingService {
  /** @param uow - Opens transactions and supplies repositories. */
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * Whether setup is needed, and the questions to ask.
   *
   * The questions come from the server so the UI has no second copy of the
   * list; a checkbox the catalog does not know about would create nothing and
   * look like a bug in the wizard.
   *
   * @param userId - The signed-in user.
   * @returns The setup state, the user's category count and the catalog's question groups.
   * @throws {NotFoundError} If the user no longer exists.
   */
  getStatus(userId: string): Promise<OnboardingStatus> {
    return this.uow.forUser(userId, async ({ onboarding }) => {
      const state = await onboarding.findState(userId)
      if (state === undefined) throw new NotFoundError('User')
      return {
        // A string, never a Date, so it survives JSON without the client guessing at the shape.
        onboardedAt: state.onboarded_at === null ? null : new Date(state.onboarded_at).toISOString(),
        // Filtered, because the column is text[] and a situation renamed by a
        // later release would otherwise come back as a checkbox that no longer exists.
        situations: state.onboarding_situations.filter(isSituation),
        categoryCount: await onboarding.countCategories(),
        groups: SITUATION_GROUPS,
      }
    })
  }

  /**
   * Counts what a set of answers would create, without creating it.
   *
   * Computed from the same selection the write path uses, so the number the
   * wizard shows cannot drift from what completing it does.
   *
   * @param situations - The situations ticked so far.
   * @returns Total, top-level count and the selected slugs.
   */
  preview(situations: readonly Situation[]): OnboardingPreview {
    const chosen = selectForSituations(withAlways(situations))
    return {
      total: chosen.length,
      parents: chosen.filter((e) => e.parent === null).length,
      slugs: chosen.map((e) => e.slug),
    }
  }

  /**
   * Finishes setup: creates the starter categories and records the answers.
   *
   * One transaction, so a failure part-way cannot leave a user marked as
   * onboarded with half a category list. Idempotent: running it twice adds
   * only what is missing.
   *
   * @param userId - The signed-in user.
   * @param situations - The situations that apply to the user.
   * @returns The creation result plus `onboarded: true`.
   */
  complete(userId: string, situations: readonly Situation[]): Promise<OnboardingResult> {
    const chosen = withAlways(situations)
    return this.uow.forUser(userId, async ({ categories, onboarding }) => {
      const result = await createStarterCategories(categories, userId, chosen)
      await onboarding.markOnboarded(userId, chosen)
      return { ...result, onboarded: true }
    })
  }

  /**
   * Puts the account back to its pre-setup state so the wizard can be run again.
   *
   * Clearing the flag and the recorded answers is all it does unless
   * `removeCategories` is set, and even then only starter categories that
   * nothing references are removed.
   *
   * @param userId - The signed-in user.
   * @param removeCategories - Whether to also delete unused starter categories.
   * @returns How many categories were removed and the names of those kept.
   */
  reset(userId: string, removeCategories: boolean): Promise<OnboardingResetResult> {
    return this.uow.forUser(userId, async ({ categories, onboarding }) => {
      const removal = removeCategories
        ? await removeUnusedStarterCategories(categories)
        : { removed: 0, kept: [] }
      await onboarding.clear(userId)
      return { onboarded: false, ...removal }
    })
  }
}
