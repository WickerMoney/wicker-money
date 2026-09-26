import { beforeEach, describe, expect, it } from 'vitest'
import type { SourceMapping } from '../../shared/index.js'
import type { BatchRepository } from '../repository/BatchRepository.js'
import type { ImportUnitOfWork } from '../repository/ImportUnitOfWork.js'
import { InMemoryImportStore } from '../testing/InMemoryImportStore.js'
import { InMemoryImportUnitOfWork } from '../testing/InMemoryImportUnitOfWork.js'
import type { CategoryResolver } from './CategoryResolver.js'
import { ImportError } from './ImportError.js'
import { ImportService } from './ImportService.js'
import { MAX_IMPORT_ROWS } from './MAX_IMPORT_ROWS.js'

const ALICE = 'user-alice'
const BOB = 'user-bob'
const ALICE_ACCOUNT = 'acct-alice'
const BOB_ACCOUNT = 'acct-bob'

const MAPPING: SourceMapping = {
  sourceName: 'Test Bank',
  columns: { date: 'Date', merchant: 'Description', amount: 'Amount', externalId: 'Id' },
  dateFormat: 'MM/DD/YYYY',
  amountStyle: 'signed',
  invertAmount: false,
}
const NO_ID_MAPPING: SourceMapping = {
  ...MAPPING,
  columns: { date: 'Date', merchant: 'Description', amount: 'Amount' },
}

const CSV = [
  'Date,Description,Amount,Id',
  '03/04/2026,COFFEE BAR,-4.50,tx-1',
  '03/05/2026,PAYCHECK,"2,500.00",tx-2',
  '03/06/2026,GROCERY WORLD,-81.20,tx-3',
].join('\n')

let store: InMemoryImportStore
let resolver: CategoryResolver

function service(): ImportService {
  return new ImportService(new InMemoryImportUnitOfWork(store), (rules, subject) => resolver(rules, subject))
}

async function failureOf(work: Promise<unknown>): Promise<ImportError> {
  try {
    await work
  } catch (error) {
    if (error instanceof ImportError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

const input = (csv: string, overrides: Record<string, unknown> = {}) => ({
  accountId: ALICE_ACCOUNT, csv, mapping: MAPPING, fileName: 'march.csv', acceptRowNumbers: [] as number[],
  ...overrides,
})

beforeEach(() => {
  store = new InMemoryImportStore()
  store.accounts.set(ALICE_ACCOUNT, ALICE)
  store.accounts.set(BOB_ACCOUNT, BOB)
  resolver = () => null
})

describe('analyze', () => {
  it('reports each row with its verdict and writes nothing', async () => {
    const result = await service().analyze(ALICE, input(CSV))
    expect(result.summary).toEqual({ total: 3, new: 3, duplicate: 0, needsReview: 0, errors: 0 })
    expect(result.rows.map((r) => r.date)).toEqual(['2026-03-04', '2026-03-05', '2026-03-06'])
    expect(store.transactions).toHaveLength(0)
    expect(store.batches).toHaveLength(0)
  })

  it('returns at most 50 row errors but counts them all', async () => {
    const bad = ['Date,Description,Amount,Id', ...Array.from({ length: 60 }, (_, i) => `nope,X,1.00,e${i}`)].join('\n')
    const result = await service().analyze(ALICE, input(bad))
    expect(result.errors).toHaveLength(50)
    expect(result.summary.errors).toBe(60)
  })

  it('answers 404 for an account the user cannot see', async () => {
    const error = await failureOf(service().analyze(ALICE, input(CSV, { accountId: BOB_ACCOUNT })))
    expect(error).toMatchObject({ statusCode: 404, code: 'not_found' })
  })

  it('refuses a file over the row cap with a 400', async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `03/04/2026,M${i},-1.00,id-${i}`)
    const error = await failureOf(service().analyze(ALICE, input(['Date,Description,Amount,Id', ...rows].join('\n'))))
    expect(error).toMatchObject({ statusCode: 400, code: 'too_many_rows' })
    expect(error.message).toContain('50,000')
  })

  it('accepts a file exactly at the row cap', async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => `03/04/2026,M${i},-1.00,id-${i}`)
    const result = await service().analyze(ALICE, input(['Date,Description,Amount,Id', ...rows].join('\n')))
    expect(result.summary.total).toBe(MAX_IMPORT_ROWS)
  })
})

describe('commit', () => {
  it('writes every new row, links them to one batch and reports the counters', async () => {
    const result = await service().commit(ALICE, input(CSV))
    expect(result).toMatchObject({ imported: 3, skipped: 0, flagged: 0, failed: 0 })

    expect(store.transactions).toHaveLength(3)
    expect(store.batches).toEqual([
      expect.objectContaining({
        id: result.batchId, accountId: ALICE_ACCOUNT, sourceName: 'Test Bank', fileName: 'march.csv',
        rowsTotal: 3, rowsImported: 3, rowsSkipped: 0, rowsFlagged: 0,
      }),
    ])
    expect(store.links.get(result.batchId)).toEqual(store.transactions.map((t) => t.id))
  })

  it('skips rows already present by external id and counts them', async () => {
    await service().commit(ALICE, input(CSV))
    const again = await service().commit(ALICE, input(CSV, { fileName: 'again.csv' }))
    expect(again).toMatchObject({ imported: 0, skipped: 3 })
    expect(store.transactions).toHaveLength(3)
    expect(store.batches[1]).toMatchObject({ rowsImported: 0, rowsSkipped: 3, rowsTotal: 3 })
  })

  it('does not import a flagged row unless its row number was accepted', async () => {
    const csv = 'Date,Description,Amount\n03/06/2026,GROCERY WORLD,-81.20'
    await service().commit(ALICE, input('Date,Description,Amount\n03/06/2026,GROCERY WORLD,-81.20', { mapping: NO_ID_MAPPING }))

    const held = await service().commit(ALICE, input(csv, { mapping: NO_ID_MAPPING, fileName: 'b.csv' }))
    expect(held).toMatchObject({ imported: 0, flagged: 1 })

    const accepted = await service().commit(
      ALICE,
      input(csv, { mapping: NO_ID_MAPPING, fileName: 'c.csv', acceptRowNumbers: [2] }),
    )
    expect(accepted).toMatchObject({ imported: 1, flagged: 1 })
    expect(store.transactions).toHaveLength(2)
  })

  it('counts a row that lost a race to a concurrent writer as skipped, not as imported', async () => {
    // The resolver runs after classification and before the insert, which is
    // exactly the window a concurrent import can slip a row into.
    resolver = () => {
      if (!store.transactions.some((t) => t.externalId === 'tx-2')) {
        store.transactions.push({
          id: 'racer', userId: ALICE, accountId: ALICE_ACCOUNT, amount: '2500.00', merchant: 'PAYCHECK',
          date: '2026-03-05', externalId: 'tx-2', categoryId: null, touched: false,
        })
      }
      return null
    }
    const result = await service().commit(ALICE, input(CSV))
    expect(result).toMatchObject({ imported: 2, skipped: 0 })
    expect(store.batches[0]).toMatchObject({ rowsImported: 2, rowsSkipped: 1, rowsTotal: 3 })
    expect(store.links.get(result.batchId)).toHaveLength(2)
  })

  it('takes the account lock before writing anything', async () => {
    await service().commit(ALICE, input(CSV))
    expect(store.lockLog).toEqual([`${ALICE}:${ALICE_ACCOUNT}`])
    expect(store.callLog).toEqual(['lock', 'insertImported', 'createBatch', 'linkMany'])
  })

  it('does not lock or write for an account the user cannot see', async () => {
    const error = await failureOf(service().commit(ALICE, input(CSV, { accountId: BOB_ACCOUNT })))
    expect(error.statusCode).toBe(404)
    expect(store.callLog).toEqual([])
    expect(store.batches).toHaveLength(0)
  })

  it('categorises through the injected resolver', async () => {
    resolver = (_rules, subject) => (subject.merchant.startsWith('COFFEE') ? 'cat-coffee' : null)
    await service().commit(ALICE, input(CSV))
    const byMerchant = new Map(store.transactions.map((t) => [t.merchant, t.categoryId]))
    expect(byMerchant.get('COFFEE BAR')).toBe('cat-coffee')
    expect(byMerchant.get('PAYCHECK')).toBeNull()
  })

  it('counts unparseable rows as failed without importing them', async () => {
    const csv = `${CSV}\nnot-a-date,BROKEN,1.00,tx-9`
    const result = await service().commit(ALICE, input(csv))
    expect(result).toMatchObject({ imported: 3, failed: 1 })
    expect(store.batches[0]?.rowsTotal).toBe(3)
  })

  it('refuses a file over the row cap before touching the ledger', async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `03/04/2026,M${i},-1.00,id-${i}`)
    const error = await failureOf(service().commit(ALICE, input(['Date,Description,Amount,Id', ...rows].join('\n'))))
    expect(error.statusCode).toBe(400)
    expect(store.callLog).toEqual([])
  })
})

describe('commit with an idempotency key', () => {
  const KEY = '6f1d2c9e-6a3b-4c58-9d7e-0a1b2c3d4e5f'

  it('records the key on the batch and answers like a commit without one', async () => {
    const result = await service().commit(ALICE, input(CSV, { idempotencyKey: KEY }))
    expect(result).toMatchObject({ imported: 3, skipped: 0, flagged: 0, failed: 0 })
    expect(result).not.toHaveProperty('replayed')
    expect(store.batches).toEqual([expect.objectContaining({ id: result.batchId, idempotencyKey: KEY })])
  })

  it('returns the original outcome for a repeat and writes nothing', async () => {
    const first = await service().commit(ALICE, input(CSV, { idempotencyKey: KEY }))
    const again = await service().commit(ALICE, input(CSV, { idempotencyKey: KEY }))
    expect(again).toEqual({ ...first, replayed: true })
    expect(store.batches).toHaveLength(1)
    expect(store.transactions).toHaveLength(3)
  })

  it('reports the first commit\'s counters even when the repeat is from a retried, changed request', async () => {
    const first = await service().commit(ALICE, input(CSV, { idempotencyKey: KEY }))
    const again = await service().commit(ALICE, input('Date,Description,Amount,Id\n04/01/2026,OTHER,-1.00,o-1', { idempotencyKey: KEY }))
    expect(again).toMatchObject({ batchId: first.batchId, imported: 3, replayed: true })
    expect(store.transactions).toHaveLength(3)
  })

  it('replays a batch that has since been reverted rather than importing again', async () => {
    const first = await service().commit(ALICE, input(CSV, { idempotencyKey: KEY }))
    await service().revert(ALICE, first.batchId)
    const again = await service().commit(ALICE, input(CSV, { idempotencyKey: KEY }))
    expect(again).toMatchObject({ batchId: first.batchId, replayed: true })
    expect(store.transactions).toHaveLength(0)
  })

  it('imports again under a different key, still deduplicating by external id', async () => {
    await service().commit(ALICE, input(CSV, { idempotencyKey: KEY }))
    const second = await service().commit(ALICE, input(CSV, { idempotencyKey: 'another-key', fileName: 'again.csv' }))
    expect(second).toMatchObject({ imported: 0, skipped: 3 })
    expect(second).not.toHaveProperty('replayed')
    expect(store.batches).toHaveLength(2)
  })

  it('imports rows without an external id at most once per key', async () => {
    const noId = 'Date,Description,Amount\n03/06/2026,GROCERY WORLD,-81.20'
    const first = await service().commit(ALICE, input(noId, { mapping: NO_ID_MAPPING, idempotencyKey: KEY }))
    const again = await service().commit(ALICE, input(noId, { mapping: NO_ID_MAPPING, idempotencyKey: KEY }))
    expect(first.imported).toBe(1)
    expect(again).toMatchObject({ batchId: first.batchId, imported: 1, replayed: true })
    expect(store.transactions).toHaveLength(1)
  })

  it('does not share keys between users', async () => {
    await service().commit(ALICE, input(CSV, { idempotencyKey: KEY }))
    const bobs = await service().commit(BOB, input(CSV, { accountId: BOB_ACCOUNT, idempotencyKey: KEY }))
    expect(bobs).toMatchObject({ imported: 3 })
    expect(bobs).not.toHaveProperty('replayed')
    expect(store.batches).toHaveLength(2)
  })

  it('takes the account lock before looking the key up', async () => {
    await service().commit(ALICE, input(CSV, { idempotencyKey: KEY }))
    store.callLog.length = 0
    await service().commit(ALICE, input(CSV, { idempotencyKey: KEY }))
    expect(store.callLog).toEqual(['lock'])
  })

  it('answers a commit that lost the race to the unique index from the winning batch', async () => {
    const first = await service().commit(ALICE, input(CSV, { idempotencyKey: KEY }))

    // The first lookup misses, as it does when the winner commits after it.
    let blind = true
    const racing: ImportUnitOfWork = {
      run: (userId, work) => {
        const hide = blind
        blind = false
        const inner = new InMemoryImportUnitOfWork(store)
        return inner.run(userId, (repos) => {
          const batches: BatchRepository = {
            listRecent: (limit) => repos.batches.listRecent(limit),
            create: (batch) => repos.batches.create(batch),
            findById: (id) => repos.batches.findById(id),
            markReverted: (id) => repos.batches.markReverted(id),
            findByIdempotencyKey: (key) => (hide ? Promise.resolve(undefined) : repos.batches.findByIdempotencyKey(key)),
          }
          return work({ ...repos, batches })
        })
      },
    }
    const loser = await new ImportService(racing, () => null).commit(ALICE, input(CSV, { idempotencyKey: KEY }))
    expect(loser).toEqual({ ...first, replayed: true })
    expect(store.batches).toHaveLength(1)
  })

  it('lets a different failure through untouched', async () => {
    const error = await failureOf(
      service().commit(ALICE, input(CSV, { accountId: BOB_ACCOUNT, idempotencyKey: KEY })),
    )
    expect(error.statusCode).toBe(404)
  })
})

describe('revert', () => {
  it('deletes what the batch created and marks it reverted', async () => {
    await service().commit(ALICE, input('Date,Description,Amount,Id\n01/01/2026,KEEP,-1.00,keep'))
    const { batchId } = await service().commit(ALICE, input(CSV, { fileName: 'undo.csv' }))
    const result = await service().revert(ALICE, batchId)
    expect(result).toEqual({ reverted: 3, skipped: 0 })
    expect(store.transactions.map((t) => t.merchant)).toEqual(['KEEP'])
    expect(store.batches[1]?.revertedAt).not.toBeNull()
  })

  it('keeps transactions changed since import and reports them as skipped', async () => {
    const { batchId } = await service().commit(ALICE, input(CSV))
    store.transactions.find((t) => t.merchant === 'PAYCHECK')!.touched = true

    const result = await service().revert(ALICE, batchId)
    expect(result).toEqual({ reverted: 2, skipped: 1 })
    expect(store.transactions.map((t) => t.merchant)).toEqual(['PAYCHECK'])
  })

  it('cannot revert the same batch twice', async () => {
    const { batchId } = await service().commit(ALICE, input(CSV))
    await service().revert(ALICE, batchId)
    const error = await failureOf(service().revert(ALICE, batchId))
    expect(error).toMatchObject({ statusCode: 409, code: 'already_reverted' })
  })

  it('reports another user\'s batch as not found and leaves it alone', async () => {
    const { batchId } = await service().commit(ALICE, input(CSV))
    const error = await failureOf(service().revert(BOB, batchId))
    expect(error).toMatchObject({ statusCode: 404, code: 'not_found' })
    expect(store.transactions).toHaveLength(3)
    expect(store.batches[0]?.revertedAt).toBeNull()
  })

  it('reports an unknown batch as not found', async () => {
    const error = await failureOf(service().revert(ALICE, 'missing'))
    expect(error.statusCode).toBe(404)
  })
})

describe('batches', () => {
  it('lists only the caller\'s batches, newest first', async () => {
    await service().commit(ALICE, input(CSV, { fileName: 'first.csv' }))
    await service().commit(ALICE, input('Date,Description,Amount,Id\n04/01/2026,X,-1.00,x1', { fileName: 'second.csv' }))
    await service().commit(BOB, input(CSV, { accountId: BOB_ACCOUNT, fileName: 'bob.csv' }))
    const batches = await service().listBatches(ALICE)
    expect(batches.map((b) => b.fileName)).toEqual(['second.csv', 'first.csv'])
  })
})

describe('mappings', () => {
  it('saves a mapping and lists it', async () => {
    const id = await service().saveMapping(ALICE, MAPPING)
    expect(id).toEqual(expect.any(String))
    const list = await service().listMappings(ALICE)
    expect(list).toEqual([expect.objectContaining({ id, sourceName: 'Test Bank', dateFormat: 'MM/DD/YYYY' })])
  })

  it('replaces the mapping with the same name ignoring case, keeping the original spelling', async () => {
    const first = await service().saveMapping(ALICE, MAPPING)
    const second = await service().saveMapping(ALICE, { ...MAPPING, sourceName: 'TEST BANK', invertAmount: true })
    expect(second).toBe(first)
    const list = await service().listMappings(ALICE)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ sourceName: 'Test Bank', invertAmount: true })
  })

  it('keeps each user\'s mappings apart and orders them by name', async () => {
    await service().saveMapping(ALICE, { ...MAPPING, sourceName: 'beta' })
    await service().saveMapping(ALICE, { ...MAPPING, sourceName: 'Alpha' })
    await service().saveMapping(BOB, { ...MAPPING, sourceName: 'Bob only' })
    expect((await service().listMappings(ALICE)).map((m) => m.sourceName)).toEqual(['Alpha', 'beta'])
    expect((await service().listMappings(BOB)).map((m) => m.sourceName)).toEqual(['Bob only'])
  })
})
