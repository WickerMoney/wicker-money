import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// @testing-library/react auto-cleans only when vitest `globals` is enabled.
afterEach(cleanup)

// findBy* and waitFor give up after 1 second by default, whatever vitest's
// testTimeout says. The page tests wait for the first plan to render (50 debts in
// the long-list test), and on a CI runner that is also building and testing ten
// other packages that can pass 1 second. Match the budget testTimeout gives them.
configure({ asyncUtilTimeout: 10_000 })
