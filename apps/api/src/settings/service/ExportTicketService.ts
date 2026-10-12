import { createHash, randomBytes } from 'node:crypto'
import type { AuthService } from '../../auth/service.js'
import { AppError } from '../../errors.js'

/** How long a freshly issued export ticket stays valid, in seconds. */
export const EXPORT_TICKET_TTL_SECONDS = 120

/** Most live tickets one user can hold; issuing another drops the oldest. */
export const MAX_LIVE_TICKETS_PER_USER = 5

/** The request header that carries the ticket on `GET /api/v1/settings/export`. */
export const EXPORT_TICKET_HEADER = 'x-wickermoney-export-ticket'

/** The session a ticket is bound to: the user and the session family of their access token. */
export interface ExportTicketHolder {
  /** User id. */
  readonly id: string
  /** The session family the caller's access token was issued under. */
  readonly sessionFamilyId: string
}

/** A newly issued ticket. */
export interface IssuedExportTicket {
  /** The secret to present in the {@link EXPORT_TICKET_HEADER} header. Shown once. */
  readonly ticket: string
  /** When it stops working, as an ISO 8601 timestamp. */
  readonly expiresAt: string
}

/** Collaborators and test seams of {@link ExportTicketService}. */
export interface ExportTicketServiceDeps {
  /** Checks the password typed to confirm. */
  readonly auth: Pick<AuthService, 'confirmPassword'>
  /** Lifetime of a ticket in seconds. Defaults to {@link EXPORT_TICKET_TTL_SECONDS}. */
  readonly ttlSeconds?: number
  /** The clock, in epoch milliseconds. Defaults to `Date.now`. */
  readonly now?: () => number
}

interface LiveTicket {
  readonly userId: string
  readonly sessionFamilyId: string
  readonly expiresAt: number
}

/**
 * The step-up for the data export: a recent password confirmation, handed to
 * the download as a short-lived, single-use ticket.
 *
 * A valid access token proves a session, not that the person at the keyboard
 * knows the password; the export is the largest read the API offers, so it asks
 * again, the way the erase actions do. {@link issue} checks the password with
 * `AuthService.confirmPassword` and returns a random ticket. {@link redeem}
 * accepts it once, from the same user in the same session, for two minutes.
 *
 * **State.** Tickets live in this process's memory, keyed by the SHA-256 of the
 * ticket, so nothing usable is stored. That matches the rate limiter, whose
 * counters are per process too. The consequences: a restart drops outstanding
 * tickets (the person confirms again), and a deployment that runs several API
 * processes behind one address needs a request for the export to reach the
 * process that issued its ticket, or a shared store; neither exists today.
 *
 * **Not rate-limited here.** Like `confirmPassword`, the HTTP layer applies the
 * limit; redeeming checks no password, so it needs none.
 */
export class ExportTicketService {
  /** Live tickets by digest; insertion order is issue order, which the per-user cap relies on. */
  private readonly live = new Map<string, LiveTicket>()
  private readonly ttlMs: number
  private readonly now: () => number

  /** @param deps - The password check, and optionally a lifetime and clock. */
  constructor(private readonly deps: ExportTicketServiceDeps) {
    this.ttlMs = (deps.ttlSeconds ?? EXPORT_TICKET_TTL_SECONDS) * 1000
    this.now = deps.now ?? (() => Date.now())
  }

  /**
   * Confirms the password and issues a ticket for the caller's session.
   *
   * @param holder - The authenticated user and their session.
   * @param password - The plaintext password typed to confirm.
   * @returns The ticket and when it expires.
   * @throws {AppError} With code `password_incorrect` (403) when the password is wrong; nothing is issued.
   */
  async issue(holder: ExportTicketHolder, password: string): Promise<IssuedExportTicket> {
    await this.deps.auth.confirmPassword(holder.id, password)

    const ticket = randomBytes(32).toString('base64url')
    const expiresAt = this.now() + this.ttlMs
    this.dropExpired()
    this.dropOldestBeyondCap(holder.id)
    this.live.set(digestOf(ticket), { userId: holder.id, sessionFamilyId: holder.sessionFamilyId, expiresAt })
    return { ticket, expiresAt: new Date(expiresAt).toISOString() }
  }

  /**
   * Spends a ticket. The first request that presents a valid one gets through;
   * every later one is refused, including one that arrives at the same moment.
   * A ticket presented by another user, or from another session of the same
   * user, is refused and left alone, so a wrong guess cannot burn the owner's.
   *
   * @param presented - The header value, if the request carried one.
   * @param holder - The authenticated user and their session.
   * @throws {AppError} `403 export_confirmation_required` when no ticket was presented.
   * @throws {AppError} `403 export_ticket_invalid` when it is unknown, expired, already used, or belongs to someone else.
   */
  redeem(presented: string | undefined, holder: ExportTicketHolder): void {
    if (presented === undefined || presented === '') {
      throw new AppError(
        'Confirm your password to export your data.', 403, 'export_confirmation_required',
      )
    }

    const key = digestOf(presented)
    const found = this.live.get(key)
    // Not a 401: the web client reads that as an expired session.
    const invalid = new AppError(
      'That export confirmation has expired or was already used. Confirm your password again.',
      403, 'export_ticket_invalid',
    )
    if (found === undefined) throw invalid
    if (found.expiresAt <= this.now()) {
      this.live.delete(key)
      throw invalid
    }
    if (found.userId !== holder.id || found.sessionFamilyId !== holder.sessionFamilyId) throw invalid

    // Synchronous from the lookup to here, so two requests cannot both pass.
    this.live.delete(key)
  }

  private dropExpired(): void {
    const now = this.now()
    for (const [key, entry] of this.live) if (entry.expiresAt <= now) this.live.delete(key)
  }

  private dropOldestBeyondCap(userId: string): void {
    const mine = [...this.live].filter(([, entry]) => entry.userId === userId)
    for (const [key] of mine.slice(0, Math.max(0, mine.length - (MAX_LIVE_TICKETS_PER_USER - 1)))) {
      this.live.delete(key)
    }
  }
}

function digestOf(ticket: string): string {
  return createHash('sha256').update(ticket).digest('hex')
}
