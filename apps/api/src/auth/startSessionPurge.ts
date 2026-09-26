import type { AuthService } from './service.js'

/** How often dead sessions are purged: hourly. */
const PURGE_EVERY_MS = 60 * 60 * 1000

/**
 * Starts the recurring purge of expired and revoked sessions.
 *
 * The timer is unref'd, so it never keeps the process alive, and a failed run
 * is reported to `onError` rather than thrown: housekeeping must not crash the
 * server, and the next run retries.
 *
 * @param auth - The service that owns session storage.
 * @param onError - Receives the error from a failed run.
 * @returns The timer, for `clearInterval` on shutdown.
 */
export function startSessionPurge(
  auth: AuthService,
  onError: (error: unknown) => void,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    auth.purgeDeadSessions().catch(onError)
  }, PURGE_EVERY_MS)
  timer.unref()
  return timer
}
