import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { ExportTicketService } from '../../service/ExportTicketService.js'
import { exportTicketBody } from '../schemas/exportTicketBody.js'

/**
 * Registers `POST /api/v1/settings/export-ticket`: trades the account password
 * for a ticket that lets one `GET /api/v1/settings/export` through.
 *
 * Body `{ password }`. Responds `200` with `{ ticket, expiresAt }`; the ticket
 * is valid for two minutes, for one download, for this user in this session,
 * and is sent in the `x-wickermoney-export-ticket` header of the export request.
 * `401` without a valid token; `403` (`password_incorrect`, issue on
 * `password`) for a wrong password, deliberately not a `401` so a typo does not
 * read as an expired session; `429` past the per-user attempt limit, which is
 * the one the erase actions use, so guessing across the three routes shares one
 * allowance. Plugin tokens are refused before the handler runs.
 *
 * @param app - The Fastify instance to register the route on; needs `@fastify/rate-limit`.
 * @param service - The export ticket service.
 * @param limit - The per-user attempt limiter.
 */
export function registerIssueExportTicket(
  app: FastifyInstance,
  service: ExportTicketService,
  limit: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
): void {
  app.post('/api/v1/settings/export-ticket', async (request, reply) => {
    const user = await app.requireAuth(request)
    await limit(request, reply)
    const body = parseBody(exportTicketBody, request.body)
    const issued = await service.issue(user, body.password)
    return reply.header('cache-control', 'no-store').code(200).send(issued)
  })
}
