import type { RecurringKind } from '../../../db/models/index.js'

/** Every `core.recurring_kind` value, for request validation. */
export const RECURRING_KINDS = ['income', 'bill', 'debt_payment', 'transfer'] as const satisfies readonly RecurringKind[]
