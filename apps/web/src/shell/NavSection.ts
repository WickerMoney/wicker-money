import type { PageContribution } from '@wickermoney/plugin-sdk'

/** A navigation section a plugin page can be placed in: `main`, `reports` or `settings`. */
export type NavSection = NonNullable<PageContribution['nav']>['section']
