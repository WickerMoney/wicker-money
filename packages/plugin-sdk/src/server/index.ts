/**
 * @module
 * The server-side half of the plugin contract: what a bundled plugin's
 * `register` function is handed by the host, and what it may throw back.
 *
 * Only bundled plugins may contribute server endpoints today; the host has no
 * sandbox for third-party server code. This entry point exists so the host and
 * every bundled plugin build against one definition instead of a private copy
 * each.
 *
 * Pure types plus two small values ({@link PluginRouteError}, {@link isUuid});
 * dependency-free (no Zod), safe to import from Node.
 */
export type { ConditionForMatching } from './ConditionForMatching.js'
export { isUuid } from './isUuid.js'
export { PluginRouteError } from './PluginRouteError.js'
export type { PluginRouteIssue } from './PluginRouteIssue.js'
export type { Query } from './Query.js'
export type { RegisterRoute } from './RegisterRoute.js'
export type { RouteContext } from './RouteContext.js'
export type { RouteMethod } from './RouteMethod.js'
export type { RuleForMatching } from './RuleForMatching.js'
export type { RuleSubject } from './RuleSubject.js'
export type { RunAsPlugin } from './RunAsPlugin.js'
