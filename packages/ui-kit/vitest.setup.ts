import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// @testing-library/react auto-cleans only when vitest `globals` is enabled.
// We keep globals off, so unmount between tests explicitly — otherwise DOM
// from one test leaks into the next and role queries match stale nodes.
afterEach(cleanup)
