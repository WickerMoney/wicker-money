import { render, screen } from '@testing-library/react'
import { lazy } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '../testing/deferred.js'
import { PageBoundary } from './PageBoundary.js'

describe('PageBoundary', () => {
  it('shows a labelled spinner until the lazy page has loaded', async () => {
    const chunk = deferred<{ default: () => React.JSX.Element }>()
    const Page = lazy(() => chunk.promise)
    render(<PageBoundary label="Accounts"><Page /></PageBoundary>)
    expect(screen.getByRole('status').textContent).toBe('Loading Accounts')
    chunk.resolve({ default: () => <h1>Loaded</h1> })
    expect(await screen.findByRole('heading', { name: 'Loaded' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('contains a failed chunk fetch to an alert instead of blanking the app', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const Page = lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module')))
    render(<PageBoundary label="Accounts"><Page /></PageBoundary>)
    expect((await screen.findByRole('alert')).textContent).toContain('Accounts failed to render.')
  })
})
