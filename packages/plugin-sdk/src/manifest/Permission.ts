import type { PERMISSIONS } from './PERMISSIONS.js'

/** One capability a plugin may declare in its manifest's `permissions`. */
export type Permission = (typeof PERMISSIONS)[number]
