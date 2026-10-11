import * as React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/ApiError.js'
import { AuthCtx } from '../../../auth/authContext.js'
import type { AuthState } from '../../../auth/AuthState.js'
import type { CurrentUser } from '../../../auth/CurrentUser.js'
import type { Person, RoleChange } from '../../../models/index.js'
import { deferred } from '../../../testing/deferred.js'
import { validationFailed } from '../../../testing/validationFailed.js'

const fetchPeople = vi.fn<() => Promise<Person[]>>()
const setPersonRole = vi.fn<(id: string, role: 'owner' | 'member') => Promise<RoleChange>>()
vi.mock('../../../people/peopleApi.js', () => ({ fetchPeople, setPersonRole }))

const { PeopleSection } = await import('./PeopleSection.js')

const person = (id: string, role: 'owner' | 'member', over: Partial<Person> = {}): Person => ({
  id, email: `${id}@example.com`, role, createdAt: '2026-09-01T12:00:00.000Z', ...over,
})

const me = person('me', 'owner', { createdAt: '2026-08-01T12:00:00.000Z' })
const bob = person('bob', 'member')
const cat = person('cat', 'owner')

const changeOf = (p: Person, role: 'owner' | 'member', changed = true): RoleChange => ({
  user: { ...p, role }, previous: { role: changed ? p.role : role }, changed,
  changedBy: { id: 'me', email: 'me@example.com' }, changedAt: '2026-10-10T00:00:00.000Z',
})

let refreshUser: ReturnType<typeof vi.fn<() => Promise<void>>>

/** Renders the section for a user whose role can be flipped by `refreshUser`, as the real provider would. */
function mount(role: 'owner' | 'member' = 'owner', afterRefresh: 'owner' | 'member' = 'member') {
  function Host() {
    const [current, setCurrent] = React.useState<CurrentUser>({ id: 'me', email: 'me@example.com', timezone: 'UTC', role })
    const value: AuthState = {
      user: current, ready: true,
      signIn: vi.fn(), register: vi.fn(), signOut: vi.fn(), setTimezone: vi.fn(),
      refreshUser: async () => { await refreshUser(); setCurrent((c) => ({ ...c, role: afterRefresh })) },
    }
    return <MemoryRouter><AuthCtx.Provider value={value}><PeopleSection /></AuthCtx.Provider></MemoryRouter>
  }
  render(<Host />)
}

const roleSelect = (email: string) => screen.getByRole<HTMLSelectElement>('combobox', { name: `Role for ${email}` })

beforeEach(() => {
  fetchPeople.mockReset()
  setPersonRole.mockReset()
  refreshUser = vi.fn(async () => {})
})

describe('PeopleSection, for a member', () => {
  it('renders nothing and never asks for the owner-only listing', async () => {
    mount('member')
    expect(screen.queryByText('People')).toBeNull()
    await act(async () => {})
    expect(fetchPeople).not.toHaveBeenCalled()
  })
})

describe('PeopleSection, for an owner', () => {
  it('lists every account with its role, marks the signed-in one, and counts them', async () => {
    fetchPeople.mockResolvedValue([me, bob, cat])
    mount()

    // The heading is there while loading; the count only once the list has arrived.
    expect(await screen.findByText('3 accounts')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'People' })).toBeTruthy()
    expect(roleSelect('me@example.com').value).toBe('owner')
    expect(roleSelect('bob@example.com').value).toBe('member')
    expect(roleSelect('cat@example.com').value).toBe('owner')
    expect(within(screen.getByText('me@example.com').closest('li')!).getByText('you')).toBeTruthy()
    expect(screen.getAllByText('you')).toHaveLength(1)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('names each role select for its account, so a list of form fields tells the rows apart', async () => {
    fetchPeople.mockResolvedValue([me, bob])
    mount()
    await screen.findByText('bob@example.com')
    const names = screen.getAllByRole('combobox').map((s) => s.getAttribute('aria-label'))
    expect(names).toEqual(['Role for me@example.com', 'Role for bob@example.com'])
    // The visible label stays the short word, and is part of the accessible name.
    expect(screen.getAllByText('Role')).toHaveLength(2)
    expect(new Set(names).size).toBe(names.length)
  })

  it('shows the join date as a time element', async () => {
    fetchPeople.mockResolvedValue([me])
    mount()
    const joined = await screen.findByText((_, el) => el?.tagName === 'TIME')
    expect(joined.getAttribute('datetime')).toBe(me.createdAt)
  })

  it('says why it could not load', async () => {
    fetchPeople.mockRejectedValue(new ApiError('Only an owner of this Wicker Money instance can do this.', 403, 'owner_required'))
    mount()
    expect((await screen.findByRole('alert')).textContent).toMatch(/Only an owner/)
  })

  it('shows a labelled spinner while loading', () => {
    fetchPeople.mockReturnValue(new Promise(() => {}))
    mount()
    expect(screen.getByText('Loading people').closest('[role="status"]')).toBeTruthy()
  })
})

describe('making someone an owner', () => {
  it('applies at once, without a confirmation, and announces it', async () => {
    const user = userEvent.setup()
    fetchPeople.mockResolvedValue([me, bob])
    setPersonRole.mockResolvedValue(changeOf(bob, 'owner'))
    mount()
    await screen.findByText('bob@example.com')

    await user.selectOptions(roleSelect('bob@example.com'), 'owner')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(setPersonRole).toHaveBeenCalledWith('bob', 'owner')
    await waitFor(() => { expect(roleSelect('bob@example.com').value).toBe('owner') })
    expect(screen.getByText('bob@example.com is now an owner.')).toBeTruthy()
    expect(screen.getByText('bob@example.com is now an owner.').getAttribute('role')).toBe('status')
  })

  it('keeps the old role showing, locked and marked busy, until the server answers', async () => {
    const user = userEvent.setup()
    const pending = deferred<RoleChange>()
    fetchPeople.mockResolvedValue([me, bob])
    setPersonRole.mockReturnValue(pending.promise)
    mount()
    await screen.findByText('bob@example.com')

    await user.selectOptions(roleSelect('bob@example.com'), 'owner')

    const select = roleSelect('bob@example.com')
    expect(select.value).toBe('member')
    expect(select.getAttribute('aria-disabled')).toBe('true')
    // Still focusable: a disabled control would throw keyboard focus back to the top of the page.
    expect(select.disabled).toBe(false)
    expect(select.closest('li')?.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('Saving…')).toBeTruthy()

    await act(async () => { pending.resolve(changeOf(bob, 'owner')) })
    await waitFor(() => { expect(roleSelect('bob@example.com').hasAttribute('aria-disabled')).toBe(false) })
    expect(roleSelect('bob@example.com').value).toBe('owner')
    expect(screen.queryByText('Saving…')).toBeNull()
  })

  it('keeps keyboard focus on the select while it saves and after, and ignores changes made meanwhile', async () => {
    const user = userEvent.setup()
    const pending = deferred<RoleChange>()
    fetchPeople.mockResolvedValue([me, bob])
    setPersonRole.mockReturnValue(pending.promise)
    mount()
    await screen.findByText('bob@example.com')
    const select = roleSelect('bob@example.com')
    select.focus()

    await user.selectOptions(select, 'owner')
    expect(document.activeElement).toBe(select)

    // A second pick while the first is saving does not send a second request.
    await user.selectOptions(select, 'owner')
    expect(setPersonRole).toHaveBeenCalledTimes(1)

    await act(async () => { pending.resolve(changeOf(bob, 'owner')) })
    await waitFor(() => { expect(select.value).toBe('owner') })
    expect(document.activeElement).toBe(select)
  })

  it('puts a refusal on that account\'s role field and leaves the role as it was', async () => {
    const user = userEvent.setup()
    fetchPeople.mockResolvedValue([me, bob])
    setPersonRole.mockRejectedValue(new ApiError('Account not found.', 404, 'not_found'))
    mount()
    await screen.findByText('bob@example.com')

    await user.selectOptions(roleSelect('bob@example.com'), 'owner')

    const select = roleSelect('bob@example.com')
    await waitFor(() => { expect(select.getAttribute('aria-invalid')).toBe('true') })
    expect(select.value).toBe('member')
    const described = select.getAttribute('aria-describedby')
    expect(document.getElementById(described ?? '')?.textContent).toBe('Account not found.')
    // Only that row carries the error.
    expect(roleSelect('me@example.com').getAttribute('aria-invalid')).toBe('false')
  })

  it('uses the issue the server attached to the role field', async () => {
    const user = userEvent.setup()
    fetchPeople.mockResolvedValue([me, bob])
    setPersonRole.mockRejectedValue(validationFailed([['role'], 'Must be one of: owner, member.']))
    mount()
    await screen.findByText('bob@example.com')
    await user.selectOptions(roleSelect('bob@example.com'), 'owner')
    expect(await screen.findByText('Must be one of: owner, member.')).toBeTruthy()
  })

  it('clears the error when the owner tries again', async () => {
    const user = userEvent.setup()
    fetchPeople.mockResolvedValue([me, bob])
    setPersonRole.mockRejectedValueOnce(new ApiError('Something went wrong.', 500, 'internal_error'))
    setPersonRole.mockResolvedValueOnce(changeOf(bob, 'owner'))
    mount()
    await screen.findByText('bob@example.com')

    await user.selectOptions(roleSelect('bob@example.com'), 'owner')
    expect(await screen.findByText('Something went wrong.')).toBeTruthy()
    await user.selectOptions(roleSelect('bob@example.com'), 'owner')
    await waitFor(() => { expect(screen.queryByText('Something went wrong.')).toBeNull() })
    expect(roleSelect('bob@example.com').value).toBe('owner')
  })
})

describe('making an owner a member', () => {
  it('asks first, saying what is lost and what is not, and changes nothing yet', async () => {
    const user = userEvent.setup()
    fetchPeople.mockResolvedValue([me, cat])
    mount()
    await screen.findByText('cat@example.com')

    await user.selectOptions(roleSelect('cat@example.com'), 'member')

    const dialog = screen.getByRole('dialog', { name: 'Make cat@example.com a member?' })
    expect(within(dialog).getByText(/no longer be able to turn plugins on or off or change/)).toBeTruthy()
    expect(within(dialog).getByText(/data and\s+sign-in are not affected/)).toBeTruthy()
    expect(setPersonRole).not.toHaveBeenCalled()
    // The select still shows the saved role behind the dialog.
    expect(roleSelect('cat@example.com').value).toBe('owner')
  })

  it('does nothing when the owner cancels, and does not start on the destructive button', async () => {
    const user = userEvent.setup()
    fetchPeople.mockResolvedValue([me, cat])
    mount()
    await screen.findByText('cat@example.com')
    await user.selectOptions(roleSelect('cat@example.com'), 'member')

    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Make member' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(setPersonRole).not.toHaveBeenCalled()
    expect(roleSelect('cat@example.com').value).toBe('owner')
  })

  it('cancels with Escape', async () => {
    const user = userEvent.setup()
    fetchPeople.mockResolvedValue([me, cat])
    mount()
    await screen.findByText('cat@example.com')
    await user.selectOptions(roleSelect('cat@example.com'), 'member')

    // jsdom has no <dialog> Escape handling; the dialog reports a close the way a browser does.
    fireClose(screen.getByRole('dialog'))

    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(setPersonRole).not.toHaveBeenCalled()
  })

  it('saves on confirm, keeps the dialog up and locked while saving, then closes it and announces', async () => {
    const user = userEvent.setup()
    const pending = deferred<RoleChange>()
    fetchPeople.mockResolvedValue([me, cat])
    setPersonRole.mockReturnValue(pending.promise)
    mount()
    await screen.findByText('cat@example.com')
    await user.selectOptions(roleSelect('cat@example.com'), 'member')

    await user.click(screen.getByRole('button', { name: 'Make member' }))

    expect(setPersonRole).toHaveBeenCalledWith('cat', 'member')
    const dialog = screen.getByRole('dialog')
    expect((within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(dialog).getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => { pending.resolve(changeOf(cat, 'member')) })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(roleSelect('cat@example.com').value).toBe('member')
    expect(screen.getByText('cat@example.com is now a member.')).toBeTruthy()
    expect(refreshUser).not.toHaveBeenCalled()
  })

  it('shows the last-owner refusal on the field after the dialog closes', async () => {
    const user = userEvent.setup()
    fetchPeople.mockResolvedValue([me, cat])
    // Another owner removed the second owner while this page was open, so the server sees one owner.
    setPersonRole.mockRejectedValue(new ApiError(
      'An instance must keep at least one owner. Make another account an owner first.', 409, 'last_owner',
    ))
    mount()
    await screen.findByText('cat@example.com')
    await user.selectOptions(roleSelect('cat@example.com'), 'member')
    await user.click(screen.getByRole('button', { name: 'Make member' }))

    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    const select = roleSelect('cat@example.com')
    expect(select.value).toBe('owner')
    expect(select.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(select.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/at least one owner/)
  })
})

describe('an owner stepping down', () => {
  it('uses plainer, stronger words when it is their own access', async () => {
    const user = userEvent.setup()
    fetchPeople.mockResolvedValue([me, cat])
    mount()
    await screen.findByText('cat@example.com')

    await user.selectOptions(roleSelect('me@example.com'), 'member')

    const dialog = screen.getByRole('dialog', { name: 'Remove your own owner access?' })
    expect(within(dialog).getByText(/only another owner can give that back/)).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Remove my owner access' })).toBeTruthy()
  })

  it('re-reads who they are, replaces the section with a notice, and moves focus to it', async () => {
    const user = userEvent.setup()
    fetchPeople.mockResolvedValue([me, cat])
    setPersonRole.mockResolvedValue(changeOf(me, 'member'))
    mount()
    await screen.findByText('cat@example.com')
    await user.selectOptions(roleSelect('me@example.com'), 'member')

    await user.click(screen.getByRole('button', { name: 'Remove my owner access' }))

    const notice = await screen.findByText(/You are now a member/)
    expect(refreshUser).toHaveBeenCalledTimes(1)
    expect(notice.getAttribute('role')).toBe('status')
    await waitFor(() => { expect(document.activeElement).toBe(notice) })
    // The role selects are gone: nothing left on screen to misuse.
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('still shows the notice if re-reading who they are fails', async () => {
    const user = userEvent.setup()
    refreshUser = vi.fn(async () => { throw new ApiError('offline', 0, 'network_error') })
    fetchPeople.mockResolvedValue([me, cat])
    setPersonRole.mockResolvedValue(changeOf(me, 'member'))
    mount()
    await screen.findByText('cat@example.com')
    await user.selectOptions(roleSelect('me@example.com'), 'member')
    await user.click(screen.getByRole('button', { name: 'Remove my owner access' }))
    expect(await screen.findByText(/You are now a member/)).toBeTruthy()
  })

  it('does not ask or call the server when they are the only owner: it explains on the field', async () => {
    const user = userEvent.setup()
    fetchPeople.mockResolvedValue([me, bob])
    mount()
    await screen.findByText('bob@example.com')

    await user.selectOptions(roleSelect('me@example.com'), 'member')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(setPersonRole).not.toHaveBeenCalled()
    const select = roleSelect('me@example.com')
    expect(select.value).toBe('owner')
    expect(select.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(select.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/only owner/)
  })

  it('lets the same owner step down once they have promoted someone in this session', async () => {
    const user = userEvent.setup()
    fetchPeople.mockResolvedValue([me, bob])
    setPersonRole.mockResolvedValueOnce(changeOf(bob, 'owner'))
    mount()
    await screen.findByText('bob@example.com')
    await user.selectOptions(roleSelect('bob@example.com'), 'owner')
    await waitFor(() => { expect(roleSelect('bob@example.com').value).toBe('owner') })

    await user.selectOptions(roleSelect('me@example.com'), 'member')
    expect(screen.getByRole('dialog', { name: 'Remove your own owner access?' })).toBeTruthy()
  })

  it('tells an owner who was demoted elsewhere that they can no longer change roles', async () => {
    const user = userEvent.setup()
    fetchPeople.mockResolvedValue([me, bob])
    setPersonRole.mockRejectedValue(new ApiError('Only an owner of this Wicker Money instance can do this.', 403, 'owner_required'))
    mount()
    await screen.findByText('bob@example.com')

    await user.selectOptions(roleSelect('bob@example.com'), 'owner')

    expect(await screen.findByText(/no longer an owner/)).toBeTruthy()
    expect(refreshUser).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})

/** Fires the `close` event a browser fires on a <dialog> when Escape is pressed. */
function fireClose(dialog: HTMLElement): void {
  act(() => { dialog.dispatchEvent(new Event('close')) })
}
