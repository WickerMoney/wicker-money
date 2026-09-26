import { beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError, ValidationError } from '../../errors.js'
import { AccountService } from './AccountService.js'
import { planMigration } from './planMigration.js'
import { previewInitialBalanceChange } from './previewInitialBalanceChange.js'
import type { NewAccount } from './NewAccount.js'
import type { FakeLedgerRow } from './testing/FakeLedger.js'
import { InMemoryUnitOfWork } from './testing/InMemoryUnitOfWork.js'

const ALICE = 'user-alice'
const BOB = 'user-bob'

const checking: NewAccount = {
  name: 'Checking',
  accountType: 'checking',
  initialBalance: '100.0000',
  currencyCode: 'USD',
  bufferAmount: '0.0000',
}

let uow: InMemoryUnitOfWork
let service: AccountService

beforeEach(() => {
  uow = new InMemoryUnitOfWork()
  service = new AccountService(uow)
})

let rowSeq = 0
function row(userId: string, accountId: string, over: Partial<FakeLedgerRow> = {}): FakeLedgerRow {
  return { id: `row-${rowSeq++}`, userId, accountId, transferAccountId: null, amount: '-10.0000', externalId: null, ...over }
}

async function twoAccounts(over: Partial<NewAccount> = {}) {
  const from = await service.create(ALICE, { ...checking, name: 'From' })
  const to = await service.create(ALICE, { ...checking, name: 'To', ...over })
  return { from, to }
}

describe('planMigration', () => {
  it('splits transfers between the accounts from other rows and totals all four counts', () => {
    expect(
      planMigration({ transferTransactions: 2, transferRecurringItems: 1, otherTransactions: 5, otherRecurringItems: 3 }),
    ).toEqual({
      removedTransferTransactions: 2,
      removedTransferRecurringItems: 1,
      movedTransactions: 5,
      movedRecurringItems: 3,
      totalAffected: 11,
    })
  })

  it('totals to zero for an account with no history', () => {
    const plan = planMigration({ transferTransactions: 0, transferRecurringItems: 0, otherTransactions: 0, otherRecurringItems: 0 })
    expect(plan.totalAffected).toBe(0)
  })
})

describe('previewInitialBalanceChange', () => {
  it('holds the ledger contribution constant while the opening number changes', () => {
    expect(previewInitialBalanceChange('500.0000', '450.0000', '300')).toEqual({
      currentInitialBalance: '500.0000',
      currentBalance: '450.0000',
      newInitialBalance: '300.0000',
      newBalance: '250.0000',
      delta: '-200.0000',
    })
  })

  it('is exact at 15 integer digits and with negative balances, where a float would round', () => {
    const preview = previewInitialBalanceChange('999999999999999.9999', '-0.0001', '-999999999999999.9999')
    expect(preview.newBalance).toBe('-1999999999999999.9999')
    expect(preview.delta).toBe('-1999999999999999.9998')
  })
})

describe('previewInitialBalanceChange zero handling', () => {
  it('never renders a negative zero', () => {
    const preview = previewInitialBalanceChange('5.0000', '5.0000', '-0')
    expect(preview.newInitialBalance).toBe('0.0000')
    expect(preview.newBalance).toBe('0.0000')
    expect(previewInitialBalanceChange('0.0000', '0.0000', '0.0000').delta).toBe('0.0000')
  })
})

describe('AccountService.migrate', () => {
  it('removes transfers between the two accounts, moves everything else and deletes the source', async () => {
    const { from, to } = await twoAccounts()
    const other = await service.create(ALICE, { ...checking, name: 'Other' })
    uow.ledger.transactions.push(
      row(ALICE, from.id, { transferAccountId: to.id }),
      row(ALICE, to.id, { transferAccountId: from.id }),
      row(ALICE, from.id, { amount: '-5.0000' }),
      row(ALICE, other.id, { transferAccountId: from.id }),
    )
    uow.ledger.recurringItems.push(row(ALICE, from.id), row(ALICE, to.id, { transferAccountId: from.id }))

    const preview = await service.previewMigration(ALICE, from.id, to.id)
    expect(preview).toEqual({
      removedTransferTransactions: 2,
      removedTransferRecurringItems: 1,
      movedTransactions: 2,
      movedRecurringItems: 1,
      totalAffected: 6,
    })

    const result = await service.migrate(ALICE, from.id, { toAccountId: to.id, confirmCount: 6 })

    expect(result).toEqual({ mergedInto: 'To', ...preview })
    expect(uow.ledger.accounts.map((a) => a.id)).not.toContain(from.id)
    expect(uow.ledger.transactions).toHaveLength(2)
    expect(uow.ledger.transactions.every((t) => t.accountId !== from.id && t.transferAccountId !== from.id)).toBe(true)
    expect(uow.ledger.transactions.every((t) => t.transferAccountId !== t.accountId)).toBe(true)
    expect(uow.ledger.recurringItems).toHaveLength(1)
  })

  it('counts a plain row (no transfer counterparty) as moved, not dropped', async () => {
    const { from, to } = await twoAccounts()
    uow.ledger.transactions.push(row(ALICE, from.id))
    expect((await service.previewMigration(ALICE, from.id, to.id)).movedTransactions).toBe(1)
  })

  it('refuses a stale confirmCount with usage_changed and changes nothing', async () => {
    const { from, to } = await twoAccounts()
    uow.ledger.transactions.push(row(ALICE, from.id))

    const error = await service.migrate(ALICE, from.id, { toAccountId: to.id, confirmCount: 0 }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).code).toBe('usage_changed')
    expect((error as ConflictError).message).toContain('now 1 affected row, not 0')
    expect(uow.ledger.accounts).toHaveLength(2)
    expect(uow.ledger.transactions[0]?.accountId).toBe(from.id)
  })

  it('rejects migrating an account into itself before opening any transaction', async () => {
    await expect(service.migrate(ALICE, 'a', { toAccountId: 'a', confirmCount: 0 })).rejects.toBeInstanceOf(ValidationError)
    await expect(service.previewMigration(ALICE, 'a', 'a')).rejects.toBeInstanceOf(ValidationError)
    expect(uow.opened).toBe(0)
  })

  it('refuses to merge accounts in different currencies, naming both', async () => {
    const { from, to } = await twoAccounts({ currencyCode: 'EUR' })
    const error = await service.previewMigration(ALICE, from.id, to.id).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).message).toContain("'From' is USD and 'To' is EUR")
  })

  it("404s when the target belongs to another user, and leaves the source alone", async () => {
    const mine = await service.create(ALICE, checking)
    const theirs = await service.create(BOB, { ...checking, name: 'Bob' })
    await expect(service.migrate(ALICE, mine.id, { toAccountId: theirs.id, confirmCount: 0 })).rejects.toBeInstanceOf(NotFoundError)
    await expect(service.previewMigration(ALICE, mine.id, theirs.id)).rejects.toBeInstanceOf(NotFoundError)
    expect(uow.ledger.accounts).toHaveLength(2)
  })

  it('reports an external-id collision as external_id_collision naming both accounts, and rolls back', async () => {
    const { from, to } = await twoAccounts()
    uow.ledger.transactions.push(
      row(ALICE, from.id, { externalId: 'bank-1' }),
      row(ALICE, to.id, { externalId: 'bank-1' }),
    )

    const error = await service.migrate(ALICE, from.id, { toAccountId: to.id, confirmCount: 1 }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).code).toBe('external_id_collision')
    expect((error as ConflictError).message).toContain("'From' and 'To'")
    expect(uow.ledger.accounts).toHaveLength(2)
    expect(uow.ledger.transactions.map((t) => t.accountId).sort()).toEqual([from.id, to.id].sort())
  })
})

describe('AccountService deletion', () => {
  it('refuses to delete an account in use, describing the usage and the alternatives', async () => {
    const account = await service.create(ALICE, checking)
    uow.ledger.transactions.push(row(ALICE, account.id), row(ALICE, account.id))
    uow.ledger.recurringItems.push(row(ALICE, account.id))

    const error = await service.delete(ALICE, account.id).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).code).toBe('account_in_use')
    expect((error as ConflictError).message).toContain("'Checking' still has 2 transactions and 1 recurring item.")
    expect((error as ConflictError).message).toContain(`/accounts/${account.id}/delete-with-history`)
    expect(uow.ledger.accounts).toHaveLength(1)
  })

  it('deletes an unused account', async () => {
    const account = await service.create(ALICE, checking)
    await service.delete(ALICE, account.id)
    expect(uow.ledger.accounts).toHaveLength(0)
  })

  it("404s deleting, or reading the usage of, another user's account", async () => {
    const theirs = await service.create(BOB, checking)
    await expect(service.delete(ALICE, theirs.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(service.usage(ALICE, theirs.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(service.deleteWithHistory(ALICE, theirs.id, 0)).rejects.toBeInstanceOf(NotFoundError)
    expect(uow.ledger.accounts).toHaveLength(1)
  })

  it('deleteWithHistory removes both transfer legs, and refuses a stale confirmCount with the current total', async () => {
    const a = await service.create(ALICE, { ...checking, name: 'A' })
    const b = await service.create(ALICE, { ...checking, name: 'B' })
    uow.ledger.transactions.push(
      row(ALICE, a.id),
      row(ALICE, a.id, { transferAccountId: b.id }),
      row(ALICE, b.id, { transferAccountId: a.id }),
    )

    const stale = await service.deleteWithHistory(ALICE, a.id, 1).catch((e: unknown) => e)
    expect((stale as ConflictError).code).toBe('usage_changed')
    expect((stale as ConflictError).message).toContain('now has 3 referencing rows, not the 1 you confirmed')

    const result = await service.deleteWithHistory(ALICE, a.id, 3)
    expect(result).toEqual({ deletedAccount: 'A', deletedTransactions: 3, deletedRecurringItems: 0 })
    expect(uow.ledger.transactions).toHaveLength(0)
    expect(uow.ledger.accounts.map((x) => x.id)).toEqual([b.id])
  })
})

describe('AccountService opening balance', () => {
  it('previews from the derived balance without changing the account', async () => {
    const account = await service.create(ALICE, { ...checking, initialBalance: '500.0000' })
    uow.ledger.transactions.push(row(ALICE, account.id, { amount: '-50.0000' }))

    const preview = await service.previewInitialBalance(ALICE, account.id, '300.0000')

    expect(preview).toMatchObject({ currentBalance: '450.0000', newBalance: '250.0000', delta: '-200.0000' })
    expect((await service.get(ALICE, account.id)).initial_balance).toBe('500.0000')
  })

  it('sets the opening balance and returns the recomputed balance', async () => {
    const account = await service.create(ALICE, { ...checking, initialBalance: '500.0000' })
    uow.ledger.transactions.push(row(ALICE, account.id, { amount: '-50.0000' }))
    const updated = await service.setInitialBalance(ALICE, account.id, '300.0000')
    expect(updated).toMatchObject({ initial_balance: '300.0000', balance: '250.0000' })
  })

  it("404s previewing or setting another user's opening balance", async () => {
    const theirs = await service.create(BOB, checking)
    await expect(service.previewInitialBalance(ALICE, theirs.id, '1')).rejects.toBeInstanceOf(NotFoundError)
    await expect(service.setInitialBalance(ALICE, theirs.id, '1')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('AccountService archive and update', () => {
  it("names 'Active account' when archiving an account that is already archived", async () => {
    const account = await service.create(ALICE, checking)
    await service.archive(ALICE, account.id)
    const error = await service.archive(ALICE, account.id).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NotFoundError)
    expect((error as NotFoundError).message).toBe('Active account not found.')
  })

  it('hides archived accounts from the default list only', async () => {
    const account = await service.create(ALICE, checking)
    await service.archive(ALICE, account.id)
    expect(await service.list(ALICE, false)).toHaveLength(0)
    expect(await service.list(ALICE, true)).toHaveLength(1)
  })

  it('updates only the fields given', async () => {
    const account = await service.create(ALICE, { ...checking, currencyCode: 'EUR', bufferAmount: '50.0000' })
    const updated = await service.update(ALICE, account.id, { name: 'Renamed' })
    expect(updated).toMatchObject({ name: 'Renamed', currency_code: 'EUR', buffer_amount: '50.0000' })
  })
})
