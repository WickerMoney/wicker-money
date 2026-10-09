import type { Config } from '../config.js'

/** The message logged when the first account to register would become the owner of an exposed instance. */
export const FIRST_REGISTRATION_WARNING = [
  'WARNING: this instance has no accounts, registration is open, and BOOTSTRAP_OWNER_EMAIL is not set.',
  'The first account anyone registers becomes the instance owner, and an owner can turn plugins on and off for everyone.',
  'If this server can be reached by anyone but you, register your own account now, or set',
  'BOOTSTRAP_OWNER_EMAIL=you@example.com and restart so only that address can become the owner.',
].join('\n  ')

/**
 * Warns, once, when a production instance would hand ownership to whoever
 * registers first.
 *
 * Fires only when all of these hold: production mode, registration open, no
 * `BOOTSTRAP_OWNER_EMAIL`, and no accounts yet. The configuration is checked
 * first, so the database is asked only in the one setup where the answer
 * matters. This is advice, never a gate: any failure to find out is swallowed
 * so it cannot stop the server starting.
 *
 * @param config - Validated configuration.
 * @param hasUsers - Whether any account exists; may reject.
 * @param warn - Receives the warning text.
 * @returns `true` if the warning was issued.
 */
export async function warnIfFirstRegistrationOpen(
  config: Pick<Config, 'NODE_ENV' | 'REGISTRATION_ENABLED' | 'BOOTSTRAP_OWNER_EMAIL'>,
  hasUsers: () => Promise<boolean>,
  warn: (message: string) => void,
): Promise<boolean> {
  if (config.NODE_ENV !== 'production') return false
  if (!config.REGISTRATION_ENABLED) return false
  if (config.BOOTSTRAP_OWNER_EMAIL !== undefined) return false
  try {
    if (await hasUsers()) return false
  } catch {
    // Not knowing is not a reason to warn, and never a reason to fail to boot.
    return false
  }
  warn(FIRST_REGISTRATION_WARNING)
  return true
}
