import type { Situation } from '../../categories/catalog.js'

/**
 * Every seed user's address lives under this domain and nowhere else, so
 * `pnpm seed --reset` can find exactly the rows it created and delete them —
 * never a real account, however the two happen to be named.
 */
export const SEED_EMAIL_DOMAIN = 'seed.wickermoney.test'

/** One fixed persona the dev dataset creates. */
export interface Persona {
  /** Stable id, also used to derive this persona's random seed. */
  readonly key: 'hero' | 'second' | 'fresh'
  /** Login email, always under {@link SEED_EMAIL_DOMAIN}. */
  readonly email: string
  /** Fixed password so the seed is a documented, repeatable login, not a mystery. */
  readonly password: string
  /** One-line description, printed by the CLI. */
  readonly description: string
  /**
   * Whether this persona runs onboarding. `false` leaves the user exactly as
   * registration creates them — no categories, no accounts, `onboarded_at`
   * still `null` — which is the only way to exercise the setup wizard itself.
   */
  readonly onboard: boolean
  /** Onboarding answers, applied only when {@link onboard} is true. `'always'` is implicit. */
  readonly situations: readonly Situation[]
}

/**
 * The three personas a seed run creates.
 *
 * `hero` is the polished one: full history, every account type, every
 * transaction shape, sized to look good in a screenshot or a recording.
 * `second` is a second onboarded household, small on purpose — its main job is
 * proving that `hero`'s data never leaks into it (or the reverse) under
 * row-level security. `fresh` never runs onboarding, so logging in as it is
 * the only way to see the setup wizard without clearing a real account.
 */
export const PERSONAS: readonly Persona[] = [
  {
    key: 'hero',
    email: `hero@${SEED_EMAIL_DOMAIN}`,
    password: 'SeedHero!2026',
    description: 'Fully onboarded, ~14 months of history, every account type and transaction shape.',
    onboard: true,
    situations: [
      'vehicle', 'car-loan', 'debt', 'investing', 'pets',
      'kids-school', 'going-out', 'wellness', 'frequent-travel',
    ],
  },
  {
    key: 'second',
    email: `second@${SEED_EMAIL_DOMAIN}`,
    password: 'SeedSecond!2026',
    description: 'A second onboarded household with a little data, for checking tenant isolation.',
    onboard: true,
    situations: ['vehicle'],
  },
  {
    key: 'fresh',
    email: `fresh@${SEED_EMAIL_DOMAIN}`,
    password: 'SeedFresh!2026',
    description: 'Just registered, never onboarded — sign in as this one to see the setup wizard.',
    onboard: false,
    situations: [],
  },
]
