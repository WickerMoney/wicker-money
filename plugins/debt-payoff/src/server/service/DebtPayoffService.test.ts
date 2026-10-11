import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_ACTIVE_DEBTS } from '../constants.js'
import { InMemoryDebtStore } from '../testing/InMemoryDebtStore.js'
import { InMemoryDebtUnitOfWork } from '../testing/InMemoryDebtUnitOfWork.js'
import { DebtPayoffError } from './DebtPayoffError.js'
import { DebtPayoffService } from './DebtPayoffService.js'
import type { NewDebtInput } from './DebtFields.js'

const ALICE = 'alice'
const BOB = 'bob'
// 2026-10-11 02:30 UTC is still the evening of the 10th in New York.
const NOW = new Date('2026-10-11T02:30:00Z')

let store: InMemoryDebtStore
let service: DebtPayoffService

const card: NewDebtInput = { name: 'Visa', balance: '1000.0000', apr: '24.9900', minimumPayment: '35.0000' }

function addAccount(userId: string, type: string, options: { name?: string; archived?: boolean } = {}): string {
  const id = store.newId()
  store.accounts.push({ id, userId, name: options.name ?? type, account_type: type, archived: options.archived ?? false })
  return id
}

async function codeOf(work: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await work
  } catch (error) {
    if (error instanceof DebtPayoffError) return { status: error.statusCode, code: error.code }
    throw error
  }
  throw new Error('Expected the call to be refused.')
}

beforeEach(() => {
  store = new InMemoryDebtStore()
  service = new DebtPayoffService(new InMemoryDebtUnitOfWork(store), () => NOW)
})

describe('creating a debt', () => {
  it('stores it and returns it, appended after the last in the person\'s list', async () => {
    const first = await service.createDebt(ALICE, card)
    const second = await service.createDebt(ALICE, { ...card, name: 'Loan' })

    expect(first).toMatchObject({ name: 'Visa', balance: '1000.0000', apr: '24.9900', minimumPayment: '35.0000', accountId: null, sortOrder: 0, archived: false })
    expect(second.sortOrder).toBe(1)
  })

  it('keeps a sort order the person gives', async () => {
    expect((await service.createDebt(ALICE, { ...card, sortOrder: 7 })).sortOrder).toBe(7)
  })

  it('links a loan or credit card account of the user\'s own', async () => {
    const visa = addAccount(ALICE, 'credit_card')
    const mortgage = addAccount(ALICE, 'loan')
    expect((await service.createDebt(ALICE, { ...card, accountId: visa })).accountId).toBe(visa)
    expect((await service.createDebt(ALICE, { ...card, name: 'House', accountId: mortgage })).accountId).toBe(mortgage)
  })

  it.each(['checking', 'savings', 'investment'])('refuses to link a %s account', async (type) => {
    const account = addAccount(ALICE, type)
    expect(await codeOf(service.createDebt(ALICE, { ...card, accountId: account }))).toEqual({ status: 400, code: 'bad_account' })
  })

  it('refuses an archived account, an unknown account and someone else\'s account', async () => {
    const archived = addAccount(ALICE, 'credit_card', { archived: true })
    const theirs = addAccount(BOB, 'credit_card')
    for (const accountId of [archived, theirs, store.newId()]) {
      expect(await codeOf(service.createDebt(ALICE, { ...card, accountId }))).toEqual({ status: 400, code: 'bad_account' })
    }
    expect(store.debts).toHaveLength(0)
  })

  it('names the field when it refuses an account', async () => {
    const error = await service.createDebt(ALICE, { ...card, accountId: store.newId() }).catch((e: unknown) => e)
    expect(error).toMatchObject({ issues: [{ path: ['accountId'] }] })
  })

  it('allows one active debt per account', async () => {
    const visa = addAccount(ALICE, 'credit_card')
    await service.createDebt(ALICE, { ...card, accountId: visa })
    expect(await codeOf(service.createDebt(ALICE, { ...card, name: 'Again', accountId: visa }))).toEqual({
      status: 409, code: 'account_already_linked',
    })
  })

  it('lets an archived debt keep its account without blocking a new one', async () => {
    const visa = addAccount(ALICE, 'credit_card')
    await service.createDebt(ALICE, { ...card, accountId: visa, archived: true })
    await expect(service.createDebt(ALICE, { ...card, name: 'New card', accountId: visa })).resolves.toMatchObject({ accountId: visa })
  })

  it(`stops at ${MAX_ACTIVE_DEBTS} debts that are not archived`, async () => {
    for (let i = 0; i < MAX_ACTIVE_DEBTS; i += 1) await service.createDebt(ALICE, { ...card, name: `Debt ${i}` })
    expect(await codeOf(service.createDebt(ALICE, card))).toEqual({ status: 409, code: 'too_many_debts' })
    // Archived debts do not count, and another person's do not either.
    await service.createDebt(ALICE, { ...card, archived: true })
    await service.createDebt(BOB, card)
  })
})

describe('changing a debt', () => {
  it('changes only the fields sent', async () => {
    const debt = await service.createDebt(ALICE, card)
    const changed = await service.updateDebt(ALICE, debt.id, { balance: '900.5000' })
    expect(changed).toEqual({ ...debt, balance: '900.5000' })
  })

  it('links, relinks and unlinks an account', async () => {
    const visa = addAccount(ALICE, 'credit_card')
    const loan = addAccount(ALICE, 'loan')
    const debt = await service.createDebt(ALICE, card)

    expect((await service.updateDebt(ALICE, debt.id, { accountId: visa })).accountId).toBe(visa)
    expect((await service.updateDebt(ALICE, debt.id, { accountId: loan })).accountId).toBe(loan)
    expect((await service.updateDebt(ALICE, debt.id, { accountId: null })).accountId).toBeNull()
  })

  it('checks a changed account like a new one, and leaves an unchanged link alone', async () => {
    const visa = addAccount(ALICE, 'credit_card')
    const debt = await service.createDebt(ALICE, { ...card, accountId: visa })
    // The account later became a checking account; saving the balance must not trip on it.
    store.accounts.find((a) => a.id === visa)!.account_type = 'checking'
    await expect(service.updateDebt(ALICE, debt.id, { balance: '5.0000' })).resolves.toMatchObject({ balance: '5.0000' })

    const checking = addAccount(ALICE, 'checking')
    expect(await codeOf(service.updateDebt(ALICE, debt.id, { accountId: checking }))).toEqual({ status: 400, code: 'bad_account' })
  })

  it('archives and un-archives, and un-archiving respects the limit', async () => {
    const debt = await service.createDebt(ALICE, card)
    expect((await service.updateDebt(ALICE, debt.id, { archived: true })).archived).toBe(true)
    for (let i = 0; i < MAX_ACTIVE_DEBTS; i += 1) await service.createDebt(ALICE, { ...card, name: `Debt ${i}` })
    expect(await codeOf(service.updateDebt(ALICE, debt.id, { archived: false }))).toEqual({ status: 409, code: 'too_many_debts' })
  })

  it('refuses to un-archive a debt whose account another debt now tracks', async () => {
    const visa = addAccount(ALICE, 'credit_card')
    const old = await service.createDebt(ALICE, { ...card, accountId: visa, archived: true })
    await service.createDebt(ALICE, { ...card, name: 'New card', accountId: visa })
    expect(await codeOf(service.updateDebt(ALICE, old.id, { archived: false }))).toEqual({
      status: 409, code: 'account_already_linked',
    })
  })

  it('reports a debt that is not there, or that is someone else\'s, as not found', async () => {
    const theirs = await service.createDebt(BOB, card)
    expect(await codeOf(service.updateDebt(ALICE, theirs.id, { name: 'Mine now' }))).toEqual({ status: 404, code: 'not_found' })
    expect(await codeOf(service.updateDebt(ALICE, store.newId(), { name: 'x' }))).toEqual({ status: 404, code: 'not_found' })
    expect(store.debts.find((d) => d.id === theirs.id)?.name).toBe('Visa')
  })
})

describe('reading and deleting', () => {
  it('lists a person\'s own debts in their own order, hiding archived ones unless asked', async () => {
    const b = await service.createDebt(ALICE, { ...card, name: 'B', sortOrder: 2 })
    const a = await service.createDebt(ALICE, { ...card, name: 'A', sortOrder: 1 })
    const old = await service.createDebt(ALICE, { ...card, name: 'Old', sortOrder: 0, archived: true })
    await service.createDebt(BOB, { ...card, name: 'Bob\'s' })

    expect((await service.listDebts(ALICE, false)).map((d) => d.id)).toEqual([a.id, b.id])
    expect((await service.listDebts(ALICE, true)).map((d) => d.id)).toEqual([old.id, a.id, b.id])
  })

  it('gets and deletes a debt, and a second delete is not found', async () => {
    const debt = await service.createDebt(ALICE, card)
    expect(await service.getDebt(ALICE, debt.id)).toEqual(debt)
    expect(await service.deleteDebt(ALICE, debt.id)).toEqual({ removed: 1 })
    expect(await codeOf(service.getDebt(ALICE, debt.id))).toEqual({ status: 404, code: 'not_found' })
    expect(await codeOf(service.deleteDebt(ALICE, debt.id))).toEqual({ status: 404, code: 'not_found' })
  })

  it('does not show or delete another person\'s debt', async () => {
    const theirs = await service.createDebt(BOB, card)
    expect(await codeOf(service.getDebt(ALICE, theirs.id))).toEqual({ status: 404, code: 'not_found' })
    expect(await codeOf(service.deleteDebt(ALICE, theirs.id))).toEqual({ status: 404, code: 'not_found' })
    expect(store.debts).toHaveLength(1)
  })
})

describe('settings', () => {
  it('start as avalanche with no extra, and say they are not saved', async () => {
    expect(await service.getSettings(ALICE)).toEqual({ extraPayment: '0.0000', strategy: 'avalanche', saved: false })
  })

  it('save either field and keep the other', async () => {
    expect(await service.saveSettings(ALICE, { extraPayment: '150.0000' })).toEqual({ extraPayment: '150.0000', strategy: 'avalanche', saved: true })
    expect(await service.saveSettings(ALICE, { strategy: 'snowball' })).toEqual({ extraPayment: '150.0000', strategy: 'snowball', saved: true })
    expect(await service.getSettings(ALICE)).toEqual({ extraPayment: '150.0000', strategy: 'snowball', saved: true })
  })

  it('are each person\'s own', async () => {
    await service.saveSettings(ALICE, { extraPayment: '99.0000', strategy: 'snowball' })
    expect(await service.getSettings(BOB)).toMatchObject({ extraPayment: '0.0000', saved: false })
  })
})

describe('the plan', () => {
  beforeEach(async () => {
    await service.createDebt(ALICE, { name: 'Big', balance: '5000.0000', apr: '24.0000', minimumPayment: '150.0000' })
    await service.createDebt(ALICE, { name: 'Small', balance: '1200.0000', apr: '8.0000', minimumPayment: '50.0000' })
  })

  it('uses the saved settings when the request names none', async () => {
    await service.saveSettings(ALICE, { extraPayment: '300.0000', strategy: 'snowball' })
    const plan = await service.getPlan(ALICE, { timezone: 'UTC' })
    expect(plan).toMatchObject({ strategy: 'snowball', extraPayment: '300.0000' })
    expect(plan.debts[0]?.name).toBe('Small')
  })

  it('defaults to avalanche with no extra before anything is saved', async () => {
    expect(await service.getPlan(ALICE, { timezone: 'UTC' })).toMatchObject({ strategy: 'avalanche', extraPayment: '0.0000' })
  })

  it('lets the request override either setting without saving it', async () => {
    await service.saveSettings(ALICE, { extraPayment: '300.0000', strategy: 'snowball' })
    const plan = await service.getPlan(ALICE, { timezone: 'UTC', strategy: 'avalanche', extraPayment: '10.0000' })
    expect(plan).toMatchObject({ strategy: 'avalanche', extraPayment: '10.0000' })
    expect(await service.getSettings(ALICE)).toMatchObject({ extraPayment: '300.0000', strategy: 'snowball' })
  })

  it('dates the plan from today in the person\'s time zone', async () => {
    expect((await service.getPlan(ALICE, { timezone: 'UTC' })).startDate).toBe('2026-10-11')
    expect((await service.getPlan(ALICE, { timezone: 'America/New_York' })).startDate).toBe('2026-10-10')
    expect((await service.getPlan(ALICE, { timezone: 'Pacific/Auckland' })).startDate).toBe('2026-10-11')
  })

  it('leaves out archived debts and other people\'s', async () => {
    await service.createDebt(ALICE, { name: 'Old', balance: '10.0000', apr: '0.0000', minimumPayment: '5.0000', archived: true })
    await service.createDebt(BOB, card)
    expect((await service.getPlan(ALICE, { timezone: 'UTC' })).debts.map((d) => d.name).sort()).toEqual(['Big', 'Small'])
  })

  it('is debt free today when there are no debts', async () => {
    expect(await service.getPlan(BOB, { timezone: 'UTC' })).toMatchObject({ months: 0, debtFreeDate: '2026-10-11', schedule: [] })
  })
})

describe('account suggestions', () => {
  it('lists unarchived loan and credit card accounts by name, with the debt tracking each', async () => {
    const visa = addAccount(ALICE, 'credit_card', { name: 'Visa' })
    addAccount(ALICE, 'loan', { name: 'Auto loan' })
    addAccount(ALICE, 'checking', { name: 'Checking' })
    addAccount(ALICE, 'loan', { name: 'Paid off', archived: true })
    addAccount(BOB, 'loan', { name: 'Bob\'s loan' })
    const debt = await service.createDebt(ALICE, { ...card, accountId: visa })

    expect(await service.listAccountSuggestions(ALICE)).toEqual([
      { id: expect.any(String), name: 'Auto loan', accountType: 'loan', debtId: null },
      { id: visa, name: 'Visa', accountType: 'credit_card', debtId: debt.id },
    ])
  })
})
