import { vi } from 'vitest'
import type { PluginApi, PluginContext } from '@wickermoney/plugin-sdk'
import type { MockApi } from './MockApi.js'

/**
 * Builds a plugin context around a mocked API.
 *
 * @param api - The API the plugin will call.
 * @param timezone - The signed-in user's zone.
 * @returns A new context object on every call, like a host that rebuilds it per render.
 */
export function makeCtx(api: MockApi, timezone = 'UTC'): PluginContext {
  return {
    session: { userId: 'u1', email: 'u@example.com', timezone },
    // The real methods are generic over the response type, which a mock
    // cannot express; the test decides what each call resolves to.
    api: api as unknown as PluginApi,
    navigate: vi.fn(),
    formatMoney: (value) => `$${value}`,
    formatDate: (value) => value,
  }
}
