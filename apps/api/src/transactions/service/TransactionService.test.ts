import { beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError, ValidationError } from '../../errors.js'
import { TransactionService } from './TransactionService.js'
import { InMemoryUnitOfWork } from './testing/InMemoryUnitOfWork.js'

const ALICE = 'user-alice'
const BOB = 'user-bob'

let uow: InMemoryUnitOfWork
let service: TransactionService

beforeEach(() => {
  uow = new InMemoryUnitOfWork()
  service = new TransactionService(uow)
  uow.ledger.accounts.push(
    { id: 'acc-checking', userId: ALICE, name: 'Checking' },
    { id: 'acc-savings', userId: ALICE, name: 'Savings' },
    { id: 'acc-bob', userId: BOB, name: 'Bob checking' },
  )
  uow.ledger.categories.push(
    { id: 'cat-food', userId: ALICE, name: 'Food' },
    { id: 'cat-fun', userId: ALICE, name: 'Fun' },
    { id: 'cat-bob', userId: BOB, name: 'Bobs' },
  )
})

async function spend(amount = '-100.00', over: { categoryId?: string | null; accountId?: string } = {}) {
  return service.create(ALICE, {
    accountId: over.accountId ?? 'acc-checking',
    amount,
    merchant: 'Shop',
    transactionDate: '2026-03-01',
    categoryId: over.categoryId ?? null,
  })
}

async function transfer(amount = '50.00') {
  return service.createTransfer(ALICE, {
    fromAccountId: 'acc-checking',
    toAccountId: 'acc-savings',
    amount,
    transactionDate: '2026-03-01',
  })
}

describe('TransactionService.create', () => {
  it('stores an explicit category as manual and a rule match as rule', async () => {
    uow.ledger.rules.push({
      category_id: 'cat-fun',
      conditions: [
        {
          condition_type: 'merchant_contains',
          text_value: 'shop',
          is_case_sensitive: false,
          direction: null,
          amount_value: null,
          amount_min: null,
          amount_max: null,
        },
      ],
    })
    const ruled = await spend()
    expect([ruled.category_id, ruled.category_source]).toEqual(['cat-fun', 'rule'])

    const manual = await spend('-5.00', { categoryId: 'cat-food' })
    expect([manual.category_id, manual.category_source]).toEqual(['cat-food', 'manual'])
  })

  it("reports another user's account as not found", async () => {
    await expect(spend('-1.00', { accountId: 'acc-bob' })).rejects.toBeInstanceOf(NotFoundError)
    await expect(spend('-1.00', { accountId: 'nope' })).rejects.toBeInstanceOf(NotFoundError)
    expect(uow.ledger.transactions).toHaveLength(0)
  })

  it("rejects another user's or an unknown category as a validation error", async () => {
    await expect(spend('-1.00', { categoryId: 'cat-bob' })).rejects.toBeInstanceOf(ValidationError)
    await expect(spend('-1.00', { categoryId: 'missing' })).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuses a transfer account on the single-row path', async () => {
    await expect(
      service.create(ALICE, {
        accountId: 'acc-checking',
        amount: '-1.00',
        merchant: 'x',
        transactionDate: '2026-03-01',
        transferAccountId: 'acc-savings',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('turns a duplicate external id into a conflict', async () => {
    const input = { accountId: 'acc-checking', amount: '-1.00', merchant: 'x', transactionDate: '2026-03-01', externalId: 'e1' }
    await service.create(ALICE, input)
    await expect(service.create(ALICE, input)).rejects.toMatchObject({ code: 'duplicate_external_id' })
  })
})

describe('TransactionService.createTransfer', () => {
  it('writes an outgoing and an incoming leg that share a transfer id', async () => {
    const { transferId, legs } = await transfer('50.00')
    const out = legs.find((l) => l.account_id === 'acc-checking')
    const into = legs.find((l) => l.account_id === 'acc-savings')
    expect(out?.amount).toBe('-50.0000')
    expect(into?.amount).toBe('50.00')
    expect(legs.every((l) => l.transfer_id === transferId)).toBe(true)
    expect(out?.merchant).toBe('Transfer to Savings')
    expect(into?.merchant).toBe('Transfer from Checking')
  })

  it('rejects the same account, non-positive amounts, and accounts that are not the user\'s', async () => {
    const base = { fromAccountId: 'acc-checking', toAccountId: 'acc-savings', amount: '1.00', transactionDate: '2026-03-01' }
    await expect(service.createTransfer(ALICE, { ...base, toAccountId: 'acc-checking' })).rejects.toBeInstanceOf(ValidationError)
    await expect(service.createTransfer(ALICE, { ...base, amount: '0.00' })).rejects.toBeInstanceOf(ValidationError)
    await expect(service.createTransfer(ALICE, { ...base, amount: '-1.00' })).rejects.toBeInstanceOf(ValidationError)
    await expect(service.createTransfer(ALICE, { ...base, toAccountId: 'acc-bob' })).rejects.toBeInstanceOf(NotFoundError)
    expect(uow.ledger.transactions).toHaveLength(0)
  })
  it('stores an external id on both legs and refuses the same transfer twice', async () => {
    const input = { fromAccountId: 'acc-checking', toAccountId: 'acc-savings', amount: '5.00', transactionDate: '2026-03-01', externalId: 't1' }
    const { legs } = await service.createTransfer(ALICE, input)
    expect(legs.map((l) => l.external_id)).toEqual(['t1', 't1'])
    const again = service.createTransfer(ALICE, input)
    await expect(again).rejects.toBeInstanceOf(ConflictError)
    await expect(again).rejects.toMatchObject({ code: 'duplicate_external_id' })
    expect(uow.ledger.transactions).toHaveLength(2)
  })

  it('writes neither leg when only one account already has the external id', async () => {
    await service.create(ALICE, { accountId: 'acc-savings', amount: '1.00', merchant: 'x', transactionDate: '2026-03-01', externalId: 't2' })
    await expect(
      service.createTransfer(ALICE, { fromAccountId: 'acc-checking', toAccountId: 'acc-savings', amount: '5.00', transactionDate: '2026-03-01', externalId: 't2' }),
    ).rejects.toMatchObject({ code: 'duplicate_external_id' })
    expect(uow.ledger.transactions).toHaveLength(1)
  })
})

describe('TransactionService.update on a transfer', () => {
  it('propagates the amount as the negation and the date to the sibling', async () => {
    const { legs } = await transfer('50.00')
    const out = legs[0]!
    await service.update(ALICE, out.id, { amount: '-80.00', transactionDate: '2026-04-01' })
    const sibling = uow.ledger.transactions.find((t) => t.id === legs[1]!.id)
    expect([sibling?.amount, sibling?.transaction_date]).toEqual(['80.0000', '2026-04-01'])
  })

  it('refuses to flip or zero a leg, so the accounts keep deciding direction', async () => {
    const { legs } = await transfer('50.00')
    await expect(service.update(ALICE, legs[0]!.id, { amount: '50.00' })).rejects.toBeInstanceOf(ValidationError)
    await expect(service.update(ALICE, legs[1]!.id, { amount: '-50.00' })).rejects.toBeInstanceOf(ValidationError)
    await expect(service.update(ALICE, legs[0]!.id, { amount: '0' })).rejects.toBeInstanceOf(ValidationError)
    expect(uow.ledger.transactions.map((t) => t.amount)).toEqual(['-50.0000', '50.00'])
  })

  it('refuses to categorize a leg or to change what is a transfer', async () => {
    const { legs } = await transfer()
    await expect(service.update(ALICE, legs[0]!.id, { categoryId: 'cat-food' })).rejects.toBeInstanceOf(ValidationError)
    await expect(service.update(ALICE, legs[0]!.id, { transferAccountId: null })).rejects.toBeInstanceOf(ValidationError)
  })

  it('locks both legs in ascending id order whichever leg is edited', async () => {
    const { legs } = await transfer()
    const sorted = legs.map((l) => l.id).sort()
    for (const leg of legs) {
      await service.update(ALICE, leg.id, { notes: 'x' })
      expect(uow.lastTransactions?.lockLog).toEqual(sorted)
    }
  })

  it('deleting either leg deletes both', async () => {
    const { legs } = await transfer()
    await service.remove(ALICE, legs[1]!.id)
    expect(uow.ledger.transactions).toHaveLength(0)
  })
})

describe('TransactionService splits', () => {
  const parts = (...amounts: string[]) => amounts.map((amount) => ({ amount, categoryId: 'cat-food' }))

  it('stores parts that share the sign and sum to the parent, and flags the parent', async () => {
    const parent = await spend('-100.00')
    const rows = await service.replaceSplits(ALICE, parent.id, parts('-60.00', '-40.00'))
    expect(rows.map((r) => r.amount)).toEqual(['-60.00', '-40.00'])
    expect(uow.ledger.transactions.find((t) => t.id === parent.id)?.is_split).toBe(true)
  })

  it('rejects mixed signs even when the total matches', async () => {
    const parent = await spend('-100.00')
    await expect(service.replaceSplits(ALICE, parent.id, parts('-150.00', '50.00'))).rejects.toBeInstanceOf(ValidationError)
    expect(uow.ledger.splits).toHaveLength(0)
    expect(uow.ledger.transactions.find((t) => t.id === parent.id)?.is_split).toBe(false)
  })

  it('rejects a positive split of a positive parent that mixes signs, and zero parts', async () => {
    const parent = await spend('100.00')
    await expect(service.replaceSplits(ALICE, parent.id, parts('120.00', '-20.00'))).rejects.toBeInstanceOf(ValidationError)
    await expect(service.replaceSplits(ALICE, parent.id, parts('100.00', '0.00'))).rejects.toBeInstanceOf(ValidationError)
    await service.replaceSplits(ALICE, parent.id, parts('70.00', '30.00'))
  })

  it('rejects parts that do not add up, comparing exactly rather than as floats', async () => {
    const parent = await spend('-0.30')
    await expect(service.replaceSplits(ALICE, parent.id, parts('-0.10', '-0.10'))).rejects.toBeInstanceOf(ValidationError)
    await service.replaceSplits(ALICE, parent.id, parts('-0.10', '-0.20'))
  })

  it('replaces the previous rows on a second call', async () => {
    const parent = await spend('-100.00')
    await service.replaceSplits(ALICE, parent.id, parts('-60.00', '-40.00'))
    await service.replaceSplits(ALICE, parent.id, parts('-25.00', '-25.00', '-50.00'))
    expect(uow.ledger.splits.map((s) => s.amount)).toEqual(['-25.00', '-25.00', '-50.00'])
  })

  it('locks the parent row before checking it', async () => {
    const parent = await spend('-100.00')
    await service.replaceSplits(ALICE, parent.id, parts('-60.00', '-40.00'))
    expect(uow.lastTransactions?.lockLog).toEqual([parent.id])
  })

  it('refuses to split a transfer leg', async () => {
    const { legs } = await transfer('50.00')
    await expect(service.replaceSplits(ALICE, legs[0]!.id, parts('-30.00', '-20.00'))).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects another user's category and hides another user's transaction", async () => {
    const parent = await spend('-100.00')
    await expect(
      service.replaceSplits(ALICE, parent.id, [{ amount: '-60.00', categoryId: 'cat-bob' }, { amount: '-40.00' }]),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(service.replaceSplits(BOB, parent.id, parts('-60.00', '-40.00'))).rejects.toBeInstanceOf(NotFoundError)
    await expect(service.listSplits(BOB, parent.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(service.removeSplits(BOB, parent.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('locks the amount of a split parent with a conflict, but allows a same-value edit and other fields', async () => {
    const parent = await spend('-100.00')
    await service.replaceSplits(ALICE, parent.id, parts('-60.00', '-40.00'))

    await expect(service.update(ALICE, parent.id, { amount: '-90.00' })).rejects.toBeInstanceOf(ConflictError)
    await expect(service.update(ALICE, parent.id, { amount: '-100.0000' })).resolves.toMatchObject({ merchant: 'Shop' })
    await expect(service.update(ALICE, parent.id, { merchant: 'Other' })).resolves.toMatchObject({ merchant: 'Other' })
    expect(uow.ledger.transactions.find((t) => t.id === parent.id)?.amount).toBe('-100.0000')
  })

  it('unlocks the amount once the splits are removed', async () => {
    const parent = await spend('-100.00')
    await service.replaceSplits(ALICE, parent.id, parts('-60.00', '-40.00'))
    await service.removeSplits(ALICE, parent.id)
    expect(uow.ledger.splits).toHaveLength(0)
    await expect(service.update(ALICE, parent.id, { amount: '-90.00' })).resolves.toMatchObject({ amount: '-90.00' })
  })

  it('removing splits from an unsplit transaction succeeds', async () => {
    const parent = await spend('-100.00')
    await expect(service.removeSplits(ALICE, parent.id)).resolves.toBeUndefined()
  })
})

describe('TransactionService.categorize', () => {
  it('assigns as manual, skips transfer legs and reports how many were skipped', async () => {
    const a = await spend('-1.00')
    const { legs } = await transfer()
    const result = await service.categorize(ALICE, [a.id, legs[0]!.id], 'cat-food')
    expect(result).toEqual({ updated: 1, requested: 2, skippedTransfers: 1 })
    expect(uow.ledger.transactions.find((t) => t.id === legs[0]!.id)?.category_id).toBeNull()
    expect(uow.ledger.transactions.find((t) => t.id === a.id)?.category_source).toBe('manual')
  })

  it('refuses when only transfer legs were selected', async () => {
    const { legs } = await transfer()
    await expect(service.categorize(ALICE, legs.map((l) => l.id), 'cat-food')).rejects.toBeInstanceOf(ValidationError)
    await expect(service.categorize(ALICE, legs.map((l) => l.id), null)).rejects.toBeInstanceOf(ValidationError)
  })

  it('clears a category and its source with null', async () => {
    const a = await spend('-1.00', { categoryId: 'cat-food' })
    await service.categorize(ALICE, [a.id], null)
    const row = uow.ledger.transactions.find((t) => t.id === a.id)
    expect([row?.category_id, row?.category_source]).toEqual([null, null])
  })

  it("rejects another user's category and updates nothing of another user's transactions", async () => {
    const a = await spend('-1.00')
    await expect(service.categorize(ALICE, [a.id], 'cat-bob')).rejects.toBeInstanceOf(ValidationError)
    expect(await service.categorize(BOB, [a.id], 'cat-bob')).toEqual({ updated: 0, requested: 1, skippedTransfers: 0 })
  })
})
