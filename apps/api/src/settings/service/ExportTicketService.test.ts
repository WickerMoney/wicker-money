import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../errors.js'
import {
  EXPORT_TICKET_TTL_SECONDS, ExportTicketService, MAX_LIVE_TICKETS_PER_USER,
  type ExportTicketHolder,
} from './ExportTicketService.js'

const ALICE: ExportTicketHolder = { id: 'alice', sessionFamilyId: 'family-1' }
const PASSWORD = 'correct-horse-battery-staple'

/** A service with a fake password check and a clock the test moves. */
function setup(ttlSeconds?: number) {
  let now = 1_000_000
  const confirmPassword = vi.fn(async (_userId: string, password: string) => {
    if (password !== PASSWORD) throw new AppError('Password is incorrect.', 403, 'password_incorrect')
  })
  const service = new ExportTicketService({
    auth: { confirmPassword }, now: () => now, ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
  })
  return { service, confirmPassword, advance: (seconds: number) => { now += seconds * 1000 }, now: () => now }
}

const codeOf = (fn: () => void): unknown => {
  try { fn() } catch (e) { return (e as AppError).code }
  return undefined
}

describe('issue', () => {
  it('checks the password with AuthService.confirmPassword for that user and issues nothing when it is wrong', async () => {
    const { service, confirmPassword } = setup()
    await expect(service.issue(ALICE, 'nope')).rejects.toMatchObject({ statusCode: 403, code: 'password_incorrect' })
    expect(confirmPassword).toHaveBeenCalledWith('alice', 'nope')
    // Nothing was stored: no string redeems.
    expect(codeOf(() => { service.redeem('nope', ALICE) })).toBe('export_ticket_invalid')
  })

  it('returns a random ticket and an expiry two minutes ahead', async () => {
    const { service, now } = setup()
    const a = await service.issue(ALICE, PASSWORD)
    const b = await service.issue(ALICE, PASSWORD)
    expect(a.ticket).not.toBe(b.ticket)
    expect(a.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Date.parse(a.expiresAt)).toBe(now() + EXPORT_TICKET_TTL_SECONDS * 1000)
    expect(EXPORT_TICKET_TTL_SECONDS).toBe(120)
  })

  it('keeps at most five live tickets per user, dropping the oldest, and leaves other users alone', async () => {
    const { service } = setup()
    const bob: ExportTicketHolder = { id: 'bob', sessionFamilyId: 'family-2' }
    const bobs = await service.issue(bob, PASSWORD)
    const mine = []
    for (let i = 0; i < MAX_LIVE_TICKETS_PER_USER + 1; i++) mine.push(await service.issue(ALICE, PASSWORD))

    expect(codeOf(() => { service.redeem(mine[0]?.ticket, ALICE) })).toBe('export_ticket_invalid')
    for (const issued of mine.slice(1)) expect(() => { service.redeem(issued.ticket, ALICE) }).not.toThrow()
    expect(() => { service.redeem(bobs.ticket, bob) }).not.toThrow()
  })
})

describe('redeem', () => {
  it('refuses a request with no ticket as a missing confirmation, 403', async () => {
    const { service } = setup()
    for (const missing of [undefined, '']) {
      try {
        service.redeem(missing, ALICE)
        expect.unreachable()
      } catch (e) {
        expect(e).toMatchObject({ statusCode: 403, code: 'export_confirmation_required' })
      }
    }
  })

  it('accepts a valid ticket once and refuses it afterwards', async () => {
    const { service } = setup()
    const { ticket } = await service.issue(ALICE, PASSWORD)
    expect(() => { service.redeem(ticket, ALICE) }).not.toThrow()
    try {
      service.redeem(ticket, ALICE)
      expect.unreachable()
    } catch (e) {
      expect(e).toMatchObject({ statusCode: 403, code: 'export_ticket_invalid' })
    }
  })

  it('lets exactly one of several requests that present the same ticket in the same tick through', async () => {
    const { service } = setup()
    const { ticket } = await service.issue(ALICE, PASSWORD)
    const outcomes = await Promise.all(Array.from({ length: 8 }, async () => {
      await Promise.resolve()
      try { service.redeem(ticket, ALICE); return 'ok' } catch { return 'refused' }
    }))
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1)
  })

  it('accepts a ticket up to its last second and refuses it at the expiry and after', async () => {
    const { service, advance } = setup()
    const early = await service.issue(ALICE, PASSWORD)
    const late = await service.issue(ALICE, PASSWORD)
    advance(EXPORT_TICKET_TTL_SECONDS - 1)
    expect(() => { service.redeem(early.ticket, ALICE) }).not.toThrow()
    advance(1)
    expect(codeOf(() => { service.redeem(late.ticket, ALICE) })).toBe('export_ticket_invalid')
  })

  it('honours a configured lifetime', async () => {
    const { service, advance } = setup(10)
    const { ticket } = await service.issue(ALICE, PASSWORD)
    advance(10)
    expect(codeOf(() => { service.redeem(ticket, ALICE) })).toBe('export_ticket_invalid')
  })

  it('refuses another user\'s ticket and does not spend it', async () => {
    const { service } = setup()
    const { ticket } = await service.issue(ALICE, PASSWORD)
    const mallory: ExportTicketHolder = { id: 'mallory', sessionFamilyId: 'family-1' }
    expect(codeOf(() => { service.redeem(ticket, mallory) })).toBe('export_ticket_invalid')
    expect(() => { service.redeem(ticket, ALICE) }).not.toThrow()
  })

  it('refuses the same user from another session and does not spend it', async () => {
    const { service } = setup()
    const { ticket } = await service.issue(ALICE, PASSWORD)
    const otherDevice: ExportTicketHolder = { id: 'alice', sessionFamilyId: 'family-2' }
    expect(codeOf(() => { service.redeem(ticket, otherDevice) })).toBe('export_ticket_invalid')
    expect(() => { service.redeem(ticket, ALICE) }).not.toThrow()
  })

  it('refuses a ticket it never issued, including near misses', async () => {
    const { service } = setup()
    const { ticket } = await service.issue(ALICE, PASSWORD)
    for (const guess of ['x', ticket.slice(0, -1), `${ticket}x`, ticket.toUpperCase(), ` ${ticket}`]) {
      expect(codeOf(() => { service.redeem(guess, ALICE) }), guess).toBe('export_ticket_invalid')
    }
    expect(() => { service.redeem(ticket, ALICE) }).not.toThrow()
  })

  it('does not hold the ticket itself, only a digest of it', async () => {
    const { service } = setup()
    const { ticket } = await service.issue(ALICE, PASSWORD)
    expect(JSON.stringify([...(service as unknown as { live: Map<string, unknown> }).live.keys()])).not.toContain(ticket)
  })
})
