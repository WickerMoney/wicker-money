import type { RegisteredPlugin } from '../../models/index.js'

/** The owner-only plugin listing, as far as it has loaded. */
export type RegisteredPluginsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly plugins: readonly RegisteredPlugin[] }
  | { readonly kind: 'error'; readonly message: string }
  /** Not requested, because the signed-in user is not an owner. */
  | { readonly kind: 'skipped' }
