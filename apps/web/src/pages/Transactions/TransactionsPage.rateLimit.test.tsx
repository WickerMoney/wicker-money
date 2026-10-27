import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../../api/client.js'
import { responseCache } from '../../api/responseCache.js'
import { renderWithToasts } from '../../testing/renderWithToasts.js'
import { TransactionsPage } from './TransactionsPage.js'

/**
 * A 429 from the API reaches the person as words on the page, not a blank or
 * broken screen: the response goes through the real client (`parseError`) and
 * the page's own alert, with `fetch` as the only thing replaced.
 */

beforeEach(() => {
  setAccessToken(null)
  responseCache.clear()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Transactions when the API refuses with 429', () => {
  it('shows the API\'s own message in the alert and keeps the page', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ code: 'rate_limited', message: 'Too many requests. Wait 12 seconds and try again.' }),
      { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '12' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    renderWithToasts(<TransactionsPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Transactions' })).toBeTruthy()
    expect((await screen.findAllByText('Too many requests. Wait 12 seconds and try again.')).length).toBeGreaterThan(0)
    // The page is still there and usable: the heading and the button that opens the entry form.
    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeTruthy()
  })

  it('says how long to wait from Retry-After when the response has no message (a proxy\'s 429)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow down', { status: 429, headers: { 'retry-after': '30' } })))

    renderWithToasts(<TransactionsPage />)

    expect((await screen.findAllByText('Too many requests. Wait 30 seconds and try again.')).length).toBeGreaterThan(0)
  })
})
