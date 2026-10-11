import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
const patch = vi.fn()
vi.mock('../api/client.js', () => ({ api: { get, patch } }))

const { fetchPeople, setPersonRole } = await import('./peopleApi.js')

beforeEach(() => {
  get.mockReset()
  patch.mockReset()
})

describe('fetchPeople', () => {
  it('reads /users and returns the accounts', async () => {
    const users = [{ id: 'a', email: 'a@example.com', role: 'owner', createdAt: '2026-10-01T00:00:00.000Z' }]
    get.mockResolvedValue({ users })
    expect(await fetchPeople()).toEqual(users)
    expect(get).toHaveBeenCalledWith('/users')
  })
})

describe('setPersonRole', () => {
  it('patches the account\'s role with the id escaped into the path', async () => {
    patch.mockResolvedValue({ changed: true })
    await setPersonRole('a/b c', 'member')
    expect(patch).toHaveBeenCalledWith('/users/a%2Fb%20c/role', { role: 'member' })
  })

  it('returns what the server says', async () => {
    const change = { user: { id: 'a' }, previous: { role: 'member' }, changed: true }
    patch.mockResolvedValue(change)
    expect(await setPersonRole('a', 'owner')).toBe(change)
  })
})
