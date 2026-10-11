import type { AccountSuggestion } from './AccountSuggestion.js'

/** `GET /account-suggestions`. */
export interface AccountSuggestionsResponse {
  readonly accounts: readonly AccountSuggestion[]
}
