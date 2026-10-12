import { PassThrough } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import { EXPORT_TICKET_HEADER, type ExportTicketService } from '../../service/ExportTicketService.js'
import type { SettingsService } from '../../service/SettingsService.js'
import { createStreamSink } from '../helpers/createStreamSink.js'

/**
 * Registers `GET /api/v1/settings/export`: everything the calling user owns,
 * as one JSON document served as a file download.
 *
 * The document is a consistent snapshot and is streamed as it is read, so a
 * large ledger does not have to fit in memory. Responds `200` with
 * `{ exportedAt, core, plugins }`, `content-type: application/json` and a
 * `content-disposition` header naming the file `wickermoney-export-<date>.json`;
 * `401` without a valid token.
 *
 * **Needs a recent password confirmation.** The request must carry a ticket
 * from `POST /api/v1/settings/export-ticket` in the `x-wickermoney-export-ticket`
 * header. Without one it is `403 export_confirmation_required`; with one that
 * is unknown, expired, already used or someone else's, `403 export_ticket_invalid`.
 * A ticket works once. The check runs before anything is read.
 *
 * A failure before the first byte is a normal
 * error response; a failure after it aborts the connection, leaving a
 * truncated (and therefore unparseable) document rather than a plausible one.
 *
 * @param app - The Fastify instance to register the route on.
 * @param service - The settings service.
 * @param tickets - Spends the ticket the request must carry.
 */
export function registerExportUserData(
  app: FastifyInstance, service: SettingsService, tickets: ExportTicketService,
): void {
  app.get('/api/v1/settings/export', async (request, reply) => {
    const user = await app.requireAuth(request)
    tickets.redeem(request.headers[EXPORT_TICKET_HEADER] as string | undefined, user)

    const body = new PassThrough()
    const sink = createStreamSink(body)
    let firstWrite!: () => void
    const started = new Promise<void>((resolve) => { firstWrite = resolve })
    const run = service.exportUserData(user.id, {
      write: (chunk) => {
        firstWrite()
        return sink.write(chunk)
      },
    })

    // Settle on whichever comes first: the first byte is ready to send, or the
    // export failed before producing one and can still be reported as an error.
    await Promise.race([started, run])

    run.then(
      () => { body.end() },
      (error: unknown) => {
        // A client that hung up destroys the stream first; that is not a server fault.
        if (!body.destroyed) request.log.error({ err: error }, 'export failed after streaming began')
        body.destroy(error instanceof Error ? error : new Error(String(error)))
      },
    )

    const today = new Date().toISOString().slice(0, 10)
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="wickermoney-export-${today}.json"`)
      .send(body)
  })
}
