import type { TransactionUndoService } from './service/TransactionUndoService.js'

/** How often expired Undo snapshots are swept: hourly. */
const PURGE_EVERY_MS = 60 * 60 * 1000

/**
 * Starts the recurring purge of expired Undo snapshots (ADR 0016).
 *
 * Every delete and restore already purges the caller's own expired snapshots;
 * this is for a person who deleted once and never came back. Like
 * `startSessionPurge`, the timer is unref'd, so it never keeps the process
 * alive, and a failed run is reported to `onError` rather than thrown: the next
 * run retries. Every instance running it is harmless, because the delete is
 * idempotent and removes only expired rows. When ADR 0011's jobs exist, this
 * moves there.
 *
 * @param undos - The service that owns snapshot storage.
 * @param onError - Receives the error from a failed run.
 * @returns The timer, for `clearInterval` on shutdown.
 */
export function startUndoPurge(undos: TransactionUndoService, onError: (error: unknown) => void): NodeJS.Timeout {
  const timer = setInterval(() => {
    undos.purgeExpired().catch(onError)
  }, PURGE_EVERY_MS)
  timer.unref()
  return timer
}
