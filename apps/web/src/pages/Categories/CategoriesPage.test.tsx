import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client.js'
import { OnboardingProvider } from '../../onboarding/OnboardingProvider.js'
import { makeCategory } from '../../testing/makeCategory.js'
import { renderWithToasts } from '../../testing/renderWithToasts.js'
import { findToast, toastTexts } from '../../testing/toastTexts.js'
import { CategoriesPage } from './CategoriesPage.js'

afterEach(() => { vi.restoreAllMocks() })

const onboarded = { onboardedAt: '2026-09-16T00:00:00.000Z', situations: ['always'], categoryCount: 1, groups: [] }

function serve() {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/onboarding') return onboarded as never
    if (path === '/categories') return [makeCategory({ id: 'cat-1', name: 'Food' })] as never
    if (path === '/category-rules') return [] as never
    if (path.endsWith('/usage')) return { total: 0, by: [], unreadable: [] } as never
    throw new Error(`unexpected GET ${path}`)
  })
}

const mount = () => renderWithToasts(<OnboardingProvider><CategoriesPage /></OnboardingProvider>)

describe('the Categories page', () => {
  it('keeps a failed load in the page banner, which is for load failures only', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/onboarding') return onboarded as never
      throw new Error('The server is down.')
    })
    mount()

    expect((await screen.findByRole('alert')).textContent).toBe('The server is down.')
    expect(toastTexts()).toEqual([])
  })

  it('says a disable happened in a toast, and nothing in the banner', async () => {
    serve()
    vi.spyOn(api, 'patch').mockResolvedValue({})
    const user = userEvent.setup()
    mount()
    const row = (await screen.findByText('Food')).closest('tr, li, [role="row"], .tbl-card') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Disable' }))

    expect(await findToast("Disabled 'Food'.")).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says a reset happened in a toast', async () => {
    serve()
    vi.spyOn(api, 'post').mockResolvedValue({ removed: 0, kept: [] })
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('button', { name: 'Reset setup' }))

    expect(await findToast()).toEqual(['Reset setup. Your categories were left alone.'])
  })
})
