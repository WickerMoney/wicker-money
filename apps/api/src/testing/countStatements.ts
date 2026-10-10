import pg from 'pg'

/**
 * @module
 * Counts the SQL statements a piece of work sends to PostgreSQL, for tests that
 * guard against a request quietly growing a query per row (the N+1 shape) or
 * re-reading the same data twice.
 */

/** What {@link countStatements} saw. */
export interface StatementCount {
  /** Every statement, in order, including transaction control and tenant binding. */
  readonly all: readonly string[]
  /**
   * The statements that read or write data: everything except `BEGIN`,
   * `COMMIT`, `ROLLBACK` and the `set_config` call that binds the tenant
   * context. This is the number to assert on, since the fixed per-request
   * overhead is not what a regression changes.
   */
  readonly data: readonly string[]
}

/** Whether a statement is transaction control or the tenant-context binding, not a read or write of data. */
function isOverhead(text: string): boolean {
  return /^\s*(begin|commit|rollback|start transaction)\b/i.test(text) || /\bset_config\(\s*'app\.user_id'/i.test(text)
}

/** The SQL text of a `pg` query call, whose first argument is a string or a config object. */
function textOf(first: unknown): string {
  if (typeof first === 'string') return first
  if (typeof first === 'object' && first !== null && 'text' in first && typeof first.text === 'string') return first.text
  return '<unknown>'
}

/** Whether a count is already running, since the patch is process-wide. */
let counting = false

/**
 * Runs `work` and records every statement any `pg` client sends meanwhile.
 *
 * It wraps `pg.Client.prototype.query`, which every connection in the pool
 * uses, so it sees statements from all of the work's connections but also from
 * anything else running in the process at the time: run it with nothing
 * else in flight, and do not nest it. Seed the data before, not inside, the
 * call.
 *
 * @param work - What to measure, typically one `app.inject` request.
 * @returns The work's result and the statements it sent.
 * @throws {Error} If a count is already running.
 */
export async function countStatements<T>(work: () => Promise<T>): Promise<{ result: T; statements: StatementCount }> {
  if (counting) throw new Error('countStatements cannot be nested or run concurrently')
  counting = true
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown }
  const original = proto.query
  const all: string[] = []
  proto.query = function (this: unknown, ...args: unknown[]) {
    all.push(textOf(args[0]))
    return original.apply(this, args)
  }
  try {
    const result = await work()
    return { result, statements: { all, data: all.filter((text) => !isOverhead(text)) } }
  } finally {
    proto.query = original
    counting = false
  }
}
