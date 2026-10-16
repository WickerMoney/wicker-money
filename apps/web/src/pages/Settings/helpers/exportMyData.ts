import { api } from '../../../api/client.js'
import { localIsoDate } from '../../../lib/localIsoDate.js'
import { downloadJson } from './downloadJson.js'

/** The header that carries the export ticket; the server reads nothing else. */
export const EXPORT_TICKET_HEADER = 'x-wickermoney-export-ticket'

/**
 * Downloads everything the signed-in user owns as one JSON file, after the
 * server has checked the password again.
 *
 * Two requests: the password buys a ticket that is good for one download for
 * two minutes, and the export is fetched with it. The password is sent once and
 * not kept; the ticket is not kept either.
 *
 * @param password - The account password, as typed.
 * @throws {ApiError} `403 password_incorrect` (issue on `password`) for a wrong password, `429` past the attempt limit, or whatever else the server refuses with.
 */
export async function exportMyData(password: string): Promise<void> {
  // Mints a ticket and changes nothing the user can read, so it keeps the response cache.
  const { ticket } = await api.post<{ ticket: string }>(
    '/settings/export-ticket', { password }, { readOnly: true },
  )
  const data = await api.get<unknown>('/settings/export', { headers: { [EXPORT_TICKET_HEADER]: ticket } })
  downloadJson(data, `wickermoney-export-${localIsoDate()}.json`)
}
