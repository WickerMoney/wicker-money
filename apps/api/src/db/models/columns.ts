import type { ColumnType } from 'kysely'

// Column aliases.
//
// These are not wrapped in `Generated<>` at use sites: `Generated<T>` is itself
// a `ColumnType`, and nesting the two leaves Kysely unable to resolve an update
// type, which surfaces as "string is not assignable to ValueExpression". The
// `*WithDefault` variants encode "optional on insert" directly.

/** A timestamp column that must be supplied on insert. */
export type Timestamp = ColumnType<Date, Date | string, Date | string>
/** A timestamp column with a database default, so it is optional on insert. */
export type TimestampWithDefault = ColumnType<Date, Date | string | undefined, Date | string>
/** A calendar date with no time, read and written as `YYYY-MM-DD`. */
export type DateOnly = ColumnType<string, string, string>
/**
 * A `numeric(19,4)` money column. Read and written as a string, never as a
 * `number`, so that no binary floating-point rounding can touch an amount.
 */
export type Money = ColumnType<string, string, string>
/** A money column with a database default, so it is optional on insert. */
export type MoneyWithDefault = ColumnType<string, string | undefined, string>
