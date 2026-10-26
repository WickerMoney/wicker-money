import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client.js'
import { makeAccount } from '../../testing/makeAccount.js'
import { renderWithToasts } from '../../testing/renderWithToasts.js'
import { findToast, toastTexts } from '../../testing/toastTexts.js'
import { AccountsPage } from './AccountsPage.js'

afterEach(() => { vi.restoreAllMocks() })

const checking = makeAccount({ id: 'chk', name: 'Checking' })
const savings = makeAccount({ id: 'sav', name: 'Savings', accountType: 'savings', spendable: false })

function serve(accounts = [checking, savings]) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/accounts/') && path.endsWith('/usage')) return { total: 0, by: [], unreadable: [] } as never
    return accounts as never
  })
}

describe('the Accounts page', () => {
  it('keeps a failed load in the page banner, which is for load failures only', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('The server is down.'))
    renderWithToasts(<AccountsPage />)

    expect((await screen.findByRole('alert')).textContent).toBe('The server is down.')
    expect(toastTexts()).toEqual([])
  })

  it('says an archive happened in a toast and leaves the banner empty', async () => {
    serve()
    vi.spyOn(api, 'post').mockResolvedValue({})
    const user = userEvent.setup()
    renderWithToasts(<AccountsPage />)
    const row = (await screen.findByText('Checking')).closest('tr, li, [role="row"], .tbl-card') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Archive' }))

    expect(await findToast("Archived 'Checking'.")).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('names the account in a toast when it is deleted with nothing on it', async () => {
    serve()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(api, 'del').mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderWithToasts(<AccountsPage />)
    const row = (await screen.findByText('Savings')).closest('tr, li, [role="row"], .tbl-card') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Delete' }))

    expect(await findToast()).toEqual(["Deleted account 'Savings'."])
  })

  it('raises the add toast once the dialog has closed', async () => {
    serve()
    vi.spyOn(api, 'post').mockResolvedValue({})
    const user = userEvent.setup()
    renderWithToasts(<AccountsPage />)
    await screen.findByText('Checking')

    await user.click(screen.getAllByRole('button', { name: 'Add account' })[0] as HTMLElement)
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'Holiday')
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }))

    expect(await findToast()).toEqual(["Added account 'Holiday'."])
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })
})
