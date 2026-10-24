/**
 * The public seed logins (apps/api/src/db/seed/seedPersonas.ts). They are
 * documented, fixed values for a throwaway dataset, not secrets. The "seed
 * completed" spec signs in as each one, so a change to the seed that this file
 * does not follow fails loudly rather than quietly.
 */
export const PERSONAS = {
  /** Fully onboarded, about 14 months of history, every account type. */
  hero: { email: 'hero@seed.wickermoney.test', password: 'SeedHero!2026' },
  /** A second onboarded household with a little data: the other tenant. */
  second: { email: 'second@seed.wickermoney.test', password: 'SeedSecond!2026' },
  /** Two incomes, recurring items, a livelier forecast. */
  household: { email: 'household@seed.wickermoney.test', password: 'SeedHousehold!2026' },
  /** Just registered, never onboarded. */
  fresh: { email: 'fresh@seed.wickermoney.test', password: 'SeedFresh!2026' },
} as const

export type PersonaKey = keyof typeof PERSONAS
