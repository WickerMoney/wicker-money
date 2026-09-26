/** A transaction a rule may act on, reduced to the fields matching needs. */
export interface RuleCandidate {
  id: string
  merchant: string
  notes: string | null
  category_id: string | null
  /** Signed decimal string, exactly as stored. Amount conditions match against this. */
  amount: string
}
