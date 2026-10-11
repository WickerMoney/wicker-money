import type { Person } from '../models/index.js'

/** The owner-only account listing, as far as it has loaded. */
export type PeopleState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly people: readonly Person[] }
  | { readonly kind: 'error'; readonly message: string }
  /** Not requested, because the signed-in user is not an owner. */
  | { readonly kind: 'skipped' }
