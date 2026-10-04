import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// @testing-library/react auto-cleans only when vitest `globals` is enabled.
afterEach(cleanup)
