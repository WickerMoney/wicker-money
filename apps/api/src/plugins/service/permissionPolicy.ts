import type { Permission } from '@wickermoney/plugin-sdk'

/**
 * @module
 * What the host does with each value of `PERMISSIONS` (ADR 0005, question 5).
 *
 * A permission a manifest can declare and the host ignores reads as a consent
 * gate and is not one, so every value is either enforced or refused. A plugin
 * that declares a refused one fails to load, with a reason that names it.
 * `permissions.test.ts` fails when a value is added to `PERMISSIONS` without a
 * decision here.
 */

/** Permissions the host enforces, each with the path of the test that proves it. None yet. */
export const IMPLEMENTED_PERMISSIONS: Readonly<Partial<Record<Permission, string>>> = {}

/**
 * Permissions the host refuses at load, until it can enforce them, and why.
 *
 * - `network:outbound`: an isolated plugin has no network at all, and a host
 *   that fetched for it would reopen the channel the frame's policy closes.
 *   Needs a design (a host allow-list and user-visible consent) first.
 * - `schedule:daily`: scheduled work is server-side code, and a third party's
 *   server code is not admitted (ADR 0007).
 * - `notify`: the broker will own it when a plugin needs it. The message type
 *   is reserved in protocol 1 and the host answers it with `not_supported`.
 */
export const REFUSED_PERMISSIONS: readonly Permission[] = ['network:outbound', 'schedule:daily', 'notify']

/**
 * @param permissions - A validated manifest's `permissions`.
 * @returns A message naming the first permission the host refuses, or `undefined` when none is.
 */
export function refusedPermission(permissions: readonly Permission[]): string | undefined {
  const refused = permissions.find((p) => REFUSED_PERMISSIONS.includes(p))
  if (refused === undefined) return undefined
  return `declares the permission '${refused}', which this host does not implement and refuses; remove it from the manifest`
}
