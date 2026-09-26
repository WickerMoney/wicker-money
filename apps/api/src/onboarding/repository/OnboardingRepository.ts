import type { OnboardingState } from './OnboardingState.js'

/** Persistence operations for setup-wizard state, which lives on the user row. */
export interface OnboardingRepository {
  /**
   * @param userId - The signed-in user.
   * @returns The user's setup state, or `undefined` if the user does not exist.
   */
  findState(userId: string): Promise<OnboardingState | undefined>

  /** @returns How many categories the user has, of any kind. */
  countCategories(): Promise<number>

  /**
   * Records that setup is finished.
   *
   * @param userId - The signed-in user.
   * @param situations - The situation slugs the user answered with.
   */
  markOnboarded(userId: string, situations: readonly string[]): Promise<void>

  /**
   * Puts the user back to the pre-setup state.
   *
   * @param userId - The signed-in user.
   */
  clear(userId: string): Promise<void>
}
