import { describe, expect, it } from 'vitest'
import type { Repositories } from '../../data/Repositories.js'
import type { UnitOfWork } from '../../data/UnitOfWork.js'
import type { RecurringItemRepository } from '../repository/RecurringItemRepository.js'
import type { RecurringItemRow } from '../repository/RecurringItemRow.js'
import { RecurringItemService } from './RecurringItemService.js'

/** A stored item with sensible defaults. */
function row(over: Partial<RecurringItemRow>): RecurringItemRow {
  return {
    id: over.name ?? 'id',
    name: 'Item',
    kind: 'bill',
    frequency: 'monthly',
    series_start_date: '2026-01-01',
    end_date: null,
    semimonthly_day_1: null,
    semimonthly_day_2: null,
    category_id: null,
    created_at: new Date(0),
    updated_at: new Date(0),
    legs: [{ account_id: 'checking', amount: '-10.0000' }],
    ...over,
  }
}

/**
 * A service over a fixed set of rows, a fixed time zone and a pinned clock.
 * Only the reads the derived fields need exist; the database behaviour is the
 * integration suite's job.
 */
function serviceOver(rows: readonly RecurringItemRow[], timezone: string, now: string): RecurringItemService {
  const recurringItems = {
    list: async () => [...rows],
    find: async (id: string) => rows.find((r) => r.id === id),
  } as Partial<RecurringItemRepository> as RecurringItemRepository
  const repos = {
    recurringItems,
    reports: { findTimezone: async () => timezone },
  } as unknown as Repositories
  const uow: UnitOfWork = {
    forUser: (_userId, work) => work(repos),
    forSystem: (work) => work(repos),
  }
  return new RecurringItemService(uow, () => new Date(now))
}

describe('RecurringItemService: "today" at the edge', () => {
  const rent = row({ id: 'rent', name: 'Rent', series_start_date: '2025-01-08' })

  it('uses the user\'s time zone, not UTC, either side of midnight', async () => {
    // 04:30 UTC on the 8th is still the evening of the 7th in New York.
    const ny = await serviceOver([rent], 'America/New_York', '2026-03-08T04:30:00Z').list('u')
    expect(ny.today).toBe('2026-03-07')
    expect(ny.items[0]?.nextDue).toBe('2026-03-08')

    const utc = await serviceOver([rent], 'UTC', '2026-03-08T04:30:00Z').list('u')
    expect(utc.today).toBe('2026-03-08')
    expect(utc.items[0]?.nextDue).toBe('2026-03-08')
  })

  it('is not moved by a DST change', async () => {
    // New York springs forward at 02:00 local on 2026-03-08 (07:00 UTC).
    const before = await serviceOver([rent], 'America/New_York', '2026-03-08T06:59:00Z').list('u')
    const after = await serviceOver([rent], 'America/New_York', '2026-03-08T07:01:00Z').list('u')
    expect(before.today).toBe('2026-03-08')
    expect(after.today).toBe('2026-03-08')
  })

  it('falls back to UTC for an unknown zone rather than failing', async () => {
    const r = await serviceOver([rent], 'Not/AZone', '2026-03-08T04:30:00Z').list('u')
    expect(r.today).toBe('2026-03-08')
  })
})

describe('RecurringItemService: derived fields', () => {
  const now = '2026-09-28T12:00:00Z'

  it('derives nextDue from the anchor, never showing the anchor itself', async () => {
    const r = await serviceOver([row({ series_start_date: '2025-01-31' })], 'UTC', now).list('u')
    expect(r.items[0]?.seriesStartDate).toBe('2025-01-31')
    expect(r.items[0]?.nextDue).toBe('2026-09-30')
  })

  it('counts something due today as due today', async () => {
    const r = await serviceOver([row({ series_start_date: '2026-01-28' })], 'UTC', now).list('u')
    expect(r.items[0]?.nextDue).toBe('2026-09-28')
  })

  it('hides ended series and past one-offs unless asked, and sorts them last', async () => {
    const rows = [
      row({ id: 'ended', name: 'A ended', end_date: '2026-08-01' }),
      row({ id: 'past', name: 'B past once', frequency: 'once', series_start_date: '2026-09-01' }),
      row({ id: 'later', name: 'C later', series_start_date: '2026-01-20' }),
      row({ id: 'soon', name: 'D soon', series_start_date: '2026-01-29' }),
    ]
    const active = await serviceOver(rows, 'UTC', now).list('u')
    expect(active.items.map((i) => i.id)).toEqual(['soon', 'later'])

    const all = await serviceOver(rows, 'UTC', now).list('u', { includeEnded: true })
    expect(all.items.map((i) => i.id)).toEqual(['soon', 'later', 'ended', 'past'])
    expect(all.items.find((i) => i.id === 'ended')?.nextDue).toBeNull()
  })

  it('narrows to the items with a leg on one account, ended ones included on request', async () => {
    const rows = [
      row({ id: 'mine', legs: [{ account_id: 'savings', amount: '-1.0000' }] }),
      row({ id: 'other', legs: [{ account_id: 'checking', amount: '-1.0000' }] }),
    ]
    const r = await serviceOver(rows, 'UTC', now).list('u', { accountId: 'savings', includeEnded: true })
    expect(r.items.map((i) => i.id)).toEqual(['mine'])
  })

  it('states the headline amount per kind and its exact monthly rate', async () => {
    const rows = [
      row({
        id: 'pay', kind: 'income', frequency: 'biweekly',
        legs: [{ account_id: 'checking', amount: '300.0000' }, { account_id: 'savings', amount: '70.0000' }],
      }),
      row({
        id: 'move', kind: 'transfer',
        legs: [{ account_id: 'checking', amount: '-200.0000' }, { account_id: 'savings', amount: '200.0000' }],
      }),
      row({ id: 'bill', kind: 'bill', frequency: 'quarterly', legs: [{ account_id: 'checking', amount: '-410.0000' }] }),
    ]
    const r = await serviceOver(rows, 'UTC', now).list('u')
    const by = Object.fromEntries(r.items.map((i) => [i.id, i]))
    // $370 biweekly is $801.67 a month, not the old app's $802.90.
    expect(by['pay']).toMatchObject({ amount: '370.0000', monthlyEquivalent: '801.6667' })
    expect(by['move']).toMatchObject({ amount: '200.0000', monthlyEquivalent: '200.0000' })
    expect(by['bill']).toMatchObject({ amount: '-410.0000', monthlyEquivalent: '-136.6667' })
  })

  it('summarizes monthly rates, leaving transfers out and counting debt payments as outgoings', async () => {
    const rows = [
      row({ id: 'pay', kind: 'income', legs: [{ account_id: 'checking', amount: '2000.0000' }] }),
      row({ id: 'rent', kind: 'bill', legs: [{ account_id: 'checking', amount: '-1500.0000' }] }),
      row({ id: 'card', kind: 'debt_payment', legs: [{ account_id: 'checking', amount: '-300.0000' }, { account_id: 'card', amount: '300.0000' }] }),
      row({ id: 'save', kind: 'transfer', legs: [{ account_id: 'checking', amount: '-100.0000' }, { account_id: 'savings', amount: '100.0000' }] }),
      row({ id: 'gone', kind: 'bill', end_date: '2026-01-01', legs: [{ account_id: 'checking', amount: '-999.0000' }] }),
    ]
    const r = await serviceOver(rows, 'UTC', now).list('u', { includeEnded: true })
    expect(r.summary).toEqual({ monthlyIncome: '2000.0000', monthlyOutgoings: '-1800.0000', monthlyNet: '200.0000' })
  })

  it('maps semimonthly columns to the SDK pair', async () => {
    const r = await serviceOver(
      [row({ frequency: 'semimonthly', semimonthly_day_1: 15, semimonthly_day_2: 31 })], 'UTC', now,
    ).list('u')
    expect(r.items[0]?.semimonthlyDays).toEqual([15, 31])
    expect(r.items[0]?.nextDue).toBe('2026-09-30')
  })
})

describe('RecurringItemService: occurrences', () => {
  const now = '2026-09-28T12:00:00Z'

  it('defaults to today through 31 days and orders by date, then name', async () => {
    const rows = [
      row({ id: 'b', name: 'B', series_start_date: '2026-01-01' }),
      row({ id: 'a', name: 'A', series_start_date: '2026-01-01' }),
    ]
    const r = await serviceOver(rows, 'UTC', now).occurrences('u')
    expect(r).toMatchObject({ today: '2026-09-28', from: '2026-09-28', to: '2026-10-29' })
    expect(r.occurrences.map((o) => `${o.date} ${o.name}`)).toEqual(['2026-10-01 A', '2026-10-01 B'])
  })

  it('refuses a reversed or oversized range', async () => {
    const service = serviceOver([], 'UTC', now)
    await expect(service.occurrences('u', { from: '2026-10-02', to: '2026-10-01' })).rejects.toThrow(/on or after from/)
    await expect(service.occurrences('u', { from: '2026-01-01', to: '2027-12-31' })).rejects.toThrow(/at most 400 days/)
  })
})
