import { api } from '../api/client.js'
import type { Person, RoleChange } from '../models/index.js'

/**
 * Lists every account on this instance, oldest first. Owner only.
 *
 * @returns The accounts, with email, role and creation time.
 * @throws {ApiError} `403` with code `owner_required` for a member.
 */
export async function fetchPeople(): Promise<Person[]> {
  return (await api.get<{ users: Person[] }>('/users')).users
}

/**
 * Gives an account the `owner` or `member` role. Owner only.
 *
 * @param userId - The account to change; may be the caller's own.
 * @param role - The role it should have.
 * @returns The account as it now is, with who changed it and when.
 * @throws {ApiError} `403` (`owner_required`) for a member, `404` for an unknown account,
 *   `409` (`last_owner`) when it would leave the instance without an owner.
 */
export function setPersonRole(userId: string, role: 'owner' | 'member'): Promise<RoleChange> {
  return api.patch<RoleChange>(`/users/${encodeURIComponent(userId)}/role`, { role })
}
