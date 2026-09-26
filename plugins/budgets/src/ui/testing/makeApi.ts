import { vi } from 'vitest'
import type { MockApi } from './MockApi.js'

/** @returns An API whose methods resolve to `undefined` until a test says otherwise. */
export function makeApi(): MockApi {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }
}
