import type { Transaction } from 'kysely'
import type { Database } from './models/index.js'

/** A Kysely transaction handle over the application schema, as passed to the callback of `asUser`. */
export type Trx = Transaction<Database>
