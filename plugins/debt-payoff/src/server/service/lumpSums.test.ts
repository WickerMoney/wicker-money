import { beforeEach, describe, expect, it } from 'vitest'
import { buildPayoffPlan } from '../../shared/index.js'
import { MAX_LUMP_SUMS } from '../constants.js'
import { InMemoryDebtStore } from '../testing/InMemoryDebtStore.js'
import { InMemoryDebtUnitOfWork } from '../testing/InMemoryDebtUnitOfWork.js'
import type { NewDebtInput } from './DebtFields.js'
import { DebtPayoffError } from './DebtPayoffError.js'
import { DebtPayoffService } from './DebtPayoffService.js'

const ALICE = 'alice'
const BOB = 'bob'
// 2026-10-11 02:30 UTC is still the evening of the 10th in New York, and the 11th in UTC.
const NOW = new Date('2026-10-11T02:30:00Z')
const START = '2026-10-11'

let store: InMemoryDebtStore
let service: DebtPayoffService

const visa: NewDebtInput = { name: 'Visa', balance: '5000.0000', apr: '24.0000', minimumPayment: '150.0000' }
const loan: NewDebtInput = { name: 'Loan', balance: '8000.0000', apr: '6.0000', minimumPayment: '200.0000' }

async function codeOf(work: Promise<unknown>): Promise<{ status: number; code: string; path?: readonly (string | number)[] }> {
  try {
    await work
  } catch (error) {
    if (error instanceof DebtPayoffError) {
      const path = error.issues?.[0]?.path
      return { status: error.statusCode, code: error.code, ...(path === undefined ? {} : { path }) }
    }
    throw error
  }
  throw new Error('Expected the call to be refused.')
}

beforeEach(() => {
  store = new InMemoryDebtStore()
  service = new DebtPayoffService(new InMemoryDebtUnitOfWork(store), () => NOW)
})

describe('lump sums: create, list, change, remove', () => {
  it('stores a lump sum with the defaults and returns it', async () => {
    const saved = await service.createLumpSum(ALICE, { onDate: '2027-01-15', amount: '1500.0000' })
    expect(saved).toMatchObject({ onDate: '2027-01-15', amount: '1500.0000', note: '', allocations: [] })
    expect(await service.listLumpSums(ALICE)).toEqual([saved])
  })

  it('lists them soonest first, and only the caller\'s', async () => {
    const later = await service.createLumpSum(ALICE, { onDate: '2027-06-01', amount: '10.0000' })
    const sooner = await service.createLumpSum(ALICE, { onDate: '2027-02-01', amount: '20.0000', note: 'refund' })
    await service.createLumpSum(BOB, { onDate: '2027-01-01', amount: '30.0000' })
    expect((await service.listLumpSums(ALICE)).map((l) => l.id)).toEqual([sooner.id, later.id])
    expect(await service.listLumpSums('nobody')).toEqual([])
  })

  it('keeps a lump sum dated in the past, so the person can see it and remove it', async () => {
    const old = await service.createLumpSum(ALICE, { onDate: '2020-01-01', amount: '10.0000' })
    expect((await service.listLumpSums(ALICE)).map((l) => l.id)).toEqual([old.id])
  })

  it('replaces the date, amount, note and allocations', async () => {
    const debt = await service.createDebt(ALICE, visa)
    const saved = await service.createLumpSum(ALICE, { onDate: '2027-01-15', amount: '500.0000', allocations: [{ debtId: debt.id, amount: '100.0000' }] })
    const changed = await service.updateLumpSum(ALICE, saved.id, { onDate: '2027-03-01', amount: '900.0000', note: 'bonus' })
    expect(changed).toEqual({ id: saved.id, onDate: '2027-03-01', amount: '900.0000', note: 'bonus', allocations: [] })
    expect(await service.listLumpSums(ALICE)).toEqual([changed])
  })

  it('removes a lump sum', async () => {
    const saved = await service.createLumpSum(ALICE, { onDate: '2027-01-15', amount: '500.0000' })
    expect(await service.deleteLumpSum(ALICE, saved.id)).toEqual({ removed: 1 })
    expect(await service.listLumpSums(ALICE)).toEqual([])
    expect(await codeOf(service.deleteLumpSum(ALICE, saved.id))).toEqual({ status: 404, code: 'not_found' })
  })

  it('answers 404 for another person\'s lump sum, as for one that does not exist, and changes nothing', async () => {
    const theirs = await service.createLumpSum(BOB, { onDate: '2027-01-15', amount: '500.0000' })
    const fields = { onDate: '2028-01-01', amount: '1.0000' }
    expect(await codeOf(service.updateLumpSum(ALICE, theirs.id, fields))).toEqual({ status: 404, code: 'not_found' })
    expect(await codeOf(service.deleteLumpSum(ALICE, theirs.id))).toEqual({ status: 404, code: 'not_found' })
    expect(await service.listLumpSums(BOB)).toEqual([theirs])
  })

  it(`refuses a lump sum past ${MAX_LUMP_SUMS}`, async () => {
    for (let i = 0; i < MAX_LUMP_SUMS; i += 1) {
      await service.createLumpSum(ALICE, { onDate: '2027-01-15', amount: '1.0000' })
    }
    expect(await codeOf(service.createLumpSum(ALICE, { onDate: '2027-01-15', amount: '1.0000' }))).toEqual({ status: 409, code: 'too_many_lump_sums' })
    // Another person's count is their own.
    await service.createLumpSum(BOB, { onDate: '2027-01-15', amount: '1.0000' })
  })
})

describe('lump sums: allocations', () => {
  it('takes parts aimed at the person\'s own debts, archived ones included', async () => {
    const a = await service.createDebt(ALICE, visa)
    const b = await service.createDebt(ALICE, { ...loan, archived: true })
    const saved = await service.createLumpSum(ALICE, {
      onDate: '2027-01-15', amount: '1000.0000',
      allocations: [{ debtId: a.id, amount: '400.0000' }, { debtId: b.id, amount: '600.0000' }],
    })
    expect(saved.allocations).toHaveLength(2)
  })

  it('refuses a debt that is not the person\'s own, answering as for one that does not exist', async () => {
    const theirs = await service.createDebt(BOB, visa)
    const refused = { status: 400, code: 'unknown_debt', path: ['allocations', 0, 'debtId'] }
    expect(await codeOf(service.createLumpSum(ALICE, { onDate: '2027-01-15', amount: '10.0000', allocations: [{ debtId: theirs.id, amount: '5.0000' }] }))).toEqual(refused)
    expect(await codeOf(service.createLumpSum(ALICE, { onDate: '2027-01-15', amount: '10.0000', allocations: [{ debtId: '00000000-0000-4000-8000-0000000000ff', amount: '5.0000' }] }))).toEqual(refused)
    expect(await service.listLumpSums(ALICE)).toEqual([])
  })

  it('refuses the same debt twice, and parts that add up to more than the lump sum', async () => {
    const a = await service.createDebt(ALICE, visa)
    const b = await service.createDebt(ALICE, loan)
    expect(await codeOf(service.createLumpSum(ALICE, {
      onDate: '2027-01-15', amount: '100.0000', allocations: [{ debtId: a.id, amount: '10.0000' }, { debtId: a.id, amount: '10.0000' }],
    }))).toEqual({ status: 400, code: 'duplicate_debt', path: ['allocations', 1, 'debtId'] })
    expect(await codeOf(service.createLumpSum(ALICE, {
      onDate: '2027-01-15', amount: '100.0000', allocations: [{ debtId: a.id, amount: '60.0000' }, { debtId: b.id, amount: '60.0000' }],
    }))).toEqual({ status: 400, code: 'allocation_too_large', path: ['allocations'] })
    // Exactly the whole is allowed.
    await service.createLumpSum(ALICE, {
      onDate: '2027-01-15', amount: '100.0000', allocations: [{ debtId: a.id, amount: '60.0000' }, { debtId: b.id, amount: '40.0000' }],
    })
  })

  it('applies the same rules when a lump sum is changed', async () => {
    const mine = await service.createDebt(ALICE, visa)
    const theirs = await service.createDebt(BOB, visa)
    const saved = await service.createLumpSum(ALICE, { onDate: '2027-01-15', amount: '100.0000', allocations: [{ debtId: mine.id, amount: '10.0000' }] })
    expect((await codeOf(service.updateLumpSum(ALICE, saved.id, { onDate: '2027-01-15', amount: '100.0000', allocations: [{ debtId: theirs.id, amount: '10.0000' }] }))).code).toBe('unknown_debt')
    expect((await codeOf(service.updateLumpSum(ALICE, saved.id, { onDate: '2027-01-15', amount: '5.0000', allocations: [{ debtId: mine.id, amount: '10.0000' }] }))).code).toBe('allocation_too_large')
    expect(await service.listLumpSums(ALICE)).toEqual([saved])
  })

  it('drops the parts aimed at a debt when the debt is deleted, and keeps the lump sum', async () => {
    const a = await service.createDebt(ALICE, visa)
    const b = await service.createDebt(ALICE, loan)
    const saved = await service.createLumpSum(ALICE, {
      onDate: '2027-01-15', amount: '100.0000', allocations: [{ debtId: a.id, amount: '10.0000' }, { debtId: b.id, amount: '20.0000' }],
    })
    await service.deleteDebt(ALICE, a.id)
    const [left] = await service.listLumpSums(ALICE)
    expect(left?.id).toBe(saved.id)
    expect(left?.allocations).toEqual([{ debtId: b.id, amount: '20.0000' }])
  })
})

describe('the plan with lump sums', () => {
  const debtsOf = async () => {
    const a = await service.createDebt(ALICE, visa)
    const b = await service.createDebt(ALICE, loan)
    return { a, b }
  }
  const direct = (ids: readonly [string, string], lumpSums?: Parameters<typeof buildPayoffPlan>[1]['lumpSums']) => buildPayoffPlan(
    [
      { id: ids[0], name: 'Visa', balance: '5000.0000', apr: '24.0000', minimumPayment: '150.0000', extraPayment: '0.0000' },
      { id: ids[1], name: 'Loan', balance: '8000.0000', apr: '6.0000', minimumPayment: '200.0000', extraPayment: '0.0000' },
    ],
    { strategy: 'avalanche', extraPayment: '0.0000', startDate: START, ...(lumpSums === undefined ? {} : { lumpSums }) },
  )

  it('is exactly what it was, with no lumpSums field, for a person who has none', async () => {
    const { a, b } = await debtsOf()
    const plan = await service.getPlan(ALICE, { timezone: 'UTC' })
    expect('lumpSums' in plan).toBe(false)
    const { excludedDebts, ...engine } = plan
    expect(excludedDebts).toEqual([])
    // Byte for byte what the engine builds from the same debts: the service adds nothing of its own.
    expect(JSON.stringify(engine)).toBe(JSON.stringify(direct([a.id, b.id])))
  })

  it('applies the person\'s lump sums on their dates, and reports each', async () => {
    const { a, b } = await debtsOf()
    await service.createLumpSum(ALICE, { onDate: '2026-12-11', amount: '3000.0000' })
    const aimed = await service.createLumpSum(ALICE, { onDate: '2027-02-11', amount: '500.0000', allocations: [{ debtId: a.id, amount: '500.0000' }] })
    const plan = await service.getPlan(ALICE, { timezone: 'UTC' })
    const base = direct([a.id, b.id])
    expect(plan.lumpSums).toHaveLength(2)
    expect(plan.lumpSums?.[0]).toMatchObject({ status: 'applied', month: 2, date: '2026-12-11', paid: '3000.0000', unused: '0.0000' })
    expect(plan.lumpSums?.[1]).toMatchObject({ id: aimed.id, status: 'applied', month: 4 })
    expect(Number(plan.totalInterest)).toBeLessThan(Number(base.totalInterest))
    expect(plan.months).toBeLessThan(base.months)
  })

  it('ignores a past-dated lump sum, says so, and gives the plan it would have given without it', async () => {
    await debtsOf()
    const before = await service.getPlan(ALICE, { timezone: 'UTC' })
    const old = await service.createLumpSum(ALICE, { onDate: '2026-10-10', amount: '9999.0000' })
    const plan = await service.getPlan(ALICE, { timezone: 'UTC' })
    expect(plan.lumpSums).toEqual([expect.objectContaining({ id: old.id, status: 'past', month: null, paid: '0.0000', unused: '9999.0000' })])
    const rest: Record<string, unknown> = { ...plan }
    delete rest['lumpSums']
    expect(JSON.stringify(rest)).toBe(JSON.stringify(before))
  })

  it('decides what is past by the person\'s own today: 2026-10-10 in New York is not yet past, in UTC it is', async () => {
    await debtsOf()
    await service.createLumpSum(ALICE, { onDate: '2026-10-10', amount: '100.0000' })
    expect((await service.getPlan(ALICE, { timezone: 'UTC' })).lumpSums?.[0]?.status).toBe('past')
    expect((await service.getPlan(ALICE, { timezone: 'America/New_York' })).lumpSums?.[0]).toMatchObject({ status: 'applied', month: 1 })
  })

  it('does not apply another person\'s lump sums', async () => {
    await debtsOf()
    await service.createLumpSum(BOB, { onDate: '2026-12-11', amount: '3000.0000' })
    expect('lumpSums' in (await service.getPlan(ALICE, { timezone: 'UTC' }))).toBe(false)
  })

  it('treats a part aimed at a debt that is left out of the plan as unallocated', async () => {
    const { b } = await debtsOf()
    await service.updateDebt(ALICE, b.id, { included: false })
    await service.createLumpSum(ALICE, { onDate: '2026-12-11', amount: '1000.0000', allocations: [{ debtId: b.id, amount: '1000.0000' }] })
    const plan = await service.getPlan(ALICE, { timezone: 'UTC' })
    expect(plan.lumpSums?.[0]).toMatchObject({ status: 'applied', paid: '1000.0000' })
  })
})

describe('what-if', () => {
  it('compares the plan with and without a candidate, and saves nothing', async () => {
    await service.createDebt(ALICE, visa)
    await service.createDebt(ALICE, loan)
    const result = await service.whatIf(ALICE, { candidate: { onDate: '2026-12-11', amount: '3000.0000' }, timezone: 'UTC' })
    expect(result.lumpSum).toMatchObject({ status: 'applied', month: 2, paid: '3000.0000' })
    expect(Number(result.interestSaved)).toBeGreaterThan(0)
    expect(result.monthsSaved).toBeGreaterThan(0)
    expect(store.lumpSums).toHaveLength(0)

    // Saving it gives the plan the what-if promised.
    await service.createLumpSum(ALICE, { onDate: '2026-12-11', amount: '3000.0000' })
    const saved = await service.getPlan(ALICE, { timezone: 'UTC' })
    expect(saved.totalInterest).toBe(result.withLumpSum.totalInterest)
    expect(saved.debtFreeDate).toBe(result.withLumpSum.debtFreeDate)
  })

  it('compares against the plan with the lump sums already saved', async () => {
    await service.createDebt(ALICE, visa)
    await service.createLumpSum(ALICE, { onDate: '2026-11-11', amount: '2000.0000' })
    const result = await service.whatIf(ALICE, { candidate: { onDate: '2026-12-11', amount: '1000.0000' }, timezone: 'UTC' })
    const now = await service.getPlan(ALICE, { timezone: 'UTC' })
    expect(result.current.totalInterest).toBe(now.totalInterest)
    expect(result.current.debtFreeDate).toBe(now.debtFreeDate)
  })

  it('uses the strategy and extra it is given, else the saved settings', async () => {
    await service.createDebt(ALICE, visa)
    await service.createDebt(ALICE, loan)
    await service.saveSettings(ALICE, { strategy: 'snowball', extraPayment: '300.0000' })
    const candidate = { onDate: '2026-12-11', amount: '1000.0000' }
    const saved = await service.whatIf(ALICE, { candidate, timezone: 'UTC' })
    const same = await service.whatIf(ALICE, { candidate, strategy: 'snowball', extraPayment: '300.0000', timezone: 'UTC' })
    const other = await service.whatIf(ALICE, { candidate, strategy: 'avalanche', extraPayment: '0.0000', timezone: 'UTC' })
    expect(same).toEqual(saved)
    expect(other.current.totalInterest).not.toBe(saved.current.totalInterest)
  })

  it('says a past-dated candidate changes nothing', async () => {
    await service.createDebt(ALICE, visa)
    const result = await service.whatIf(ALICE, { candidate: { onDate: '2020-01-01', amount: '5000.0000' }, timezone: 'UTC' })
    expect(result.lumpSum.status).toBe('past')
    expect(result.interestSaved).toBe('0.0000')
    expect(result.monthsSaved).toBe(0)
  })

  it('refuses an allocation to another person\'s debt', async () => {
    await service.createDebt(ALICE, visa)
    const theirs = await service.createDebt(BOB, visa)
    expect((await codeOf(service.whatIf(ALICE, {
      candidate: { onDate: '2026-12-11', amount: '10.0000', allocations: [{ debtId: theirs.id, amount: '5.0000' }] }, timezone: 'UTC',
    }))).code).toBe('unknown_debt')
  })

  it('leaves out debts that are not in the plan, as the plan does', async () => {
    const a = await service.createDebt(ALICE, visa)
    const b = await service.createDebt(ALICE, loan)
    await service.updateDebt(ALICE, b.id, { included: false })
    const result = await service.whatIf(ALICE, { candidate: { onDate: '2026-12-11', amount: '1000.0000', allocations: [{ debtId: a.id, amount: '1000.0000' }] }, timezone: 'UTC' })
    const plan = await service.getPlan(ALICE, { timezone: 'UTC' })
    expect(result.current.totalInterest).toBe(plan.totalInterest)
  })
})
