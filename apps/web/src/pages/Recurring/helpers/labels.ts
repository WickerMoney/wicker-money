import type { RecurrenceFrequency, RecurringKind } from '../../../models/index.js'

/** What each kind is called in the form and the list. */
export const KIND_LABELS: Readonly<Record<RecurringKind, string>> = {
  income: 'Income',
  bill: 'Bill',
  debt_payment: 'Debt payment',
  transfer: 'Transfer',
}

/** Kinds in the order the form offers them. */
export const KINDS: readonly RecurringKind[] = ['bill', 'income', 'transfer', 'debt_payment']

/** What each frequency is called in the form. */
export const FREQUENCY_LABELS: Readonly<Record<RecurrenceFrequency, string>> = {
  once: 'Once',
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  semimonthly: 'Twice a month',
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  annual: 'Yearly',
}

/** Frequencies in the order the form offers them: commonest first. */
export const FREQUENCIES: readonly RecurrenceFrequency[] = [
  'monthly', 'biweekly', 'semimonthly', 'weekly', 'quarterly', 'annual', 'once', 'daily',
]
