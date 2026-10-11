import type { Mock } from 'vitest'

/** The signature every mocked API method shares. */
export type MockCall = (path: string, bodyOrInit?: unknown, init?: RequestInit) => Promise<unknown>

/** A plugin API whose every method is a mock a test can program and inspect. */
export interface MockApi {
  readonly get: Mock<MockCall>
  readonly post: Mock<MockCall>
  readonly put: Mock<MockCall>
  readonly del: Mock<MockCall>
}
