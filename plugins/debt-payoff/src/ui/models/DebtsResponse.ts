import type { Debt } from './Debt.js'

/** `GET /debts`. */
export interface DebtsResponse {
  readonly debts: readonly Debt[]
}
