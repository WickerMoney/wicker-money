import type { Query } from '@wickermoney/plugin-sdk/server'
import type { DebtRepository } from './DebtRepository.js'
import type { DebtRow } from './DebtRow.js'
import type { ExportedDebt } from './ExportedDebt.js'
import type { NewDebt } from './NewDebt.js'

/**
 * {@link DebtRepository} over a user-bound query runner.
 *
 * Money and the rate are selected as `::text` so PostgreSQL's exact decimal
 * reaches TypeScript as a string, never a `number`. Writes cast the incoming
 * string with `::numeric`, which is exact.
 */
export class QueryDebtRepository implements DebtRepository {
  /** @param q - A query runner already bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  list(includeArchived: boolean): Promise<DebtRow[]> {
    return this.q<DebtRow>`
      SELECT id, name, balance::text AS balance, apr::text AS apr,
             minimum_payment::text AS minimum_payment, account_id, sort_order, archived
      FROM plugin_debt_payoff.debts
      WHERE (${includeArchived}::boolean OR NOT archived)
      ORDER BY sort_order, created_at, id
    `
  }

  /** @inheritdoc */
  async find(id: string): Promise<DebtRow | undefined> {
    const rows = await this.q<DebtRow>`
      SELECT id, name, balance::text AS balance, apr::text AS apr,
             minimum_payment::text AS minimum_payment, account_id, sort_order, archived
      FROM plugin_debt_payoff.debts
      WHERE id = ${id}::uuid
    `
    return rows[0]
  }

  /** @inheritdoc */
  async findForUpdate(id: string): Promise<DebtRow | undefined> {
    const rows = await this.q<DebtRow>`
      SELECT id, name, balance::text AS balance, apr::text AS apr,
             minimum_payment::text AS minimum_payment, account_id, sort_order, archived
      FROM plugin_debt_payoff.debts
      WHERE id = ${id}::uuid
      FOR UPDATE
    `
    return rows[0]
  }

  /** @inheritdoc */
  async countActive(): Promise<number> {
    const rows = await this.q<{ n: number }>`
      SELECT count(*)::int AS n FROM plugin_debt_payoff.debts WHERE NOT archived
    `
    return rows[0]?.n ?? 0
  }

  /** @inheritdoc */
  async insert(debt: NewDebt): Promise<DebtRow | undefined> {
    // With no sort order given a debt goes after the last one. Row-level
    // security narrows the max() to this user's rows, so it needs no WHERE.
    const rows = await this.q<DebtRow>`
      INSERT INTO plugin_debt_payoff.debts
        (user_id, name, balance, apr, minimum_payment, account_id, sort_order, archived)
      VALUES (
        core.current_user_id(), ${debt.name}, ${debt.balance}::numeric, ${debt.apr}::numeric,
        ${debt.minimumPayment}::numeric, ${debt.accountId}::uuid,
        COALESCE(${debt.sortOrder ?? null}::integer, (SELECT COALESCE(max(sort_order) + 1, 0) FROM plugin_debt_payoff.debts)),
        ${debt.archived}
      )
      RETURNING id, name, balance::text AS balance, apr::text AS apr,
                minimum_payment::text AS minimum_payment, account_id, sort_order, archived
    `
    return rows[0]
  }

  /** @inheritdoc */
  async replace(
    id: string,
    debt: Omit<NewDebt, 'sortOrder'> & { readonly sortOrder: number },
  ): Promise<DebtRow | undefined> {
    const rows = await this.q<DebtRow>`
      UPDATE plugin_debt_payoff.debts
      SET name = ${debt.name},
          balance = ${debt.balance}::numeric,
          apr = ${debt.apr}::numeric,
          minimum_payment = ${debt.minimumPayment}::numeric,
          account_id = ${debt.accountId}::uuid,
          sort_order = ${debt.sortOrder}::integer,
          archived = ${debt.archived},
          updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING id, name, balance::text AS balance, apr::text AS apr,
                minimum_payment::text AS minimum_payment, account_id, sort_order, archived
    `
    return rows[0]
  }

  /** @inheritdoc */
  async delete(id: string): Promise<number> {
    const gone = await this.q<{ id: string }>`
      DELETE FROM plugin_debt_payoff.debts WHERE id = ${id}::uuid RETURNING id
    `
    return gone.length
  }

  /** @inheritdoc */
  listAll(): Promise<ExportedDebt[]> {
    return this.q<ExportedDebt>`
      SELECT id, name, balance::text AS balance, apr::text AS apr,
             minimum_payment::text AS minimum_payment, account_id, sort_order, archived,
             created_at, updated_at
      FROM plugin_debt_payoff.debts
      ORDER BY sort_order, created_at, id
    `
  }
}
