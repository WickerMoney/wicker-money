import type { InstanceEraseCheck } from '../state/InstanceEraseCheck.js'

/**
 * The sentence shown when an erase would leave an instance nobody could set up
 * again.
 *
 * @param check - The preflight answer.
 * @returns The explanation, or `null` when nothing stands in the way.
 */
export function describeBlocker(check: InstanceEraseCheck): string | null {
  if (check.blocker === 'registration_disabled') {
    return 'Registration is turned off on this server (REGISTRATION_ENABLED=false), so nobody could register as the owner after an erase. Turn it on and restart the server first.'
  }
  if (check.blocker === 'bootstrap_owner_mismatch') {
    return `BOOTSTRAP_OWNER_EMAIL is set to ${check.bootstrapOwnerEmail ?? 'another address'}, so after an erase only that address could become the owner, not you. Erase while signed in as that account, or change the setting and restart the server first.`
  }
  return null
}
