import { vi } from 'vitest'
import type { ActionStatus } from '../hooks/useActionStatus.js'

/** An {@link ActionStatus} whose methods are spies, for asserting what a hook reported. */
export interface FakeStatus extends ActionStatus {
  /** Spy behind `begin`. */
  readonly begin: ReturnType<typeof vi.fn<() => void>>
  /** Spy behind `end`. */
  readonly end: ReturnType<typeof vi.fn<() => void>>
  /** Spy behind `show`. */
  readonly show: ReturnType<typeof vi.fn<(message: string | null) => void>>
}

/**
 * Builds a fake status for testing a hook that takes one.
 *
 * @returns A status with spy methods, idle and without a message.
 */
export function makeStatus(): FakeStatus {
  return { message: null, busy: false, begin: vi.fn(), end: vi.fn(), show: vi.fn() }
}
