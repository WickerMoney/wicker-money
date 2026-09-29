import type { RecurringItem } from '../../../models/index.js'
import type { RecurringDraft } from '../state/RecurringDraft.js'

/** The body `POST`/`PUT /recurring-items` takes. */
export interface RecurringPayload {
  readonly name: string
  readonly kind: RecurringDraft['kind']
  readonly frequency: RecurringDraft['frequency']
  readonly seriesStartDate: string
  readonly endDate: string | null
  readonly semimonthlyDays: readonly [number, number] | null
  readonly categoryId: string | null
  readonly legs: readonly { readonly accountId: string; readonly amount: string }[]
}

/**
 * A blank form, starting today and paying from the first account offered.
 *
 * @param today - The server's today, `YYYY-MM-DD`.
 * @param firstAccountId - The account to preselect, or `''`.
 * @returns The draft.
 */
export function emptyDraft(today: string, firstAccountId = ''): RecurringDraft {
  return {
    name: '', kind: 'bill', frequency: 'monthly', seriesStartDate: today, endDate: '',
    day1: '1', day2: '15', categoryId: '', amount: '',
    fromAccountId: firstAccountId, toAccountId: '',
    splits: [{ accountId: firstAccountId, amount: '' }],
  }
}

/**
 * The form state for editing an existing item: signs are dropped, since the
 * kind puts them back.
 *
 * @param item - The item as listed.
 * @returns The draft.
 */
export function draftFromItem(item: RecurringItem): RecurringDraft {
  const out = item.legs.find((l) => l.amount.startsWith('-'))
  const into = item.legs.find((l) => !l.amount.startsWith('-'))
  return {
    name: item.name,
    kind: item.kind,
    frequency: item.frequency,
    seriesStartDate: item.seriesStartDate,
    endDate: item.endDate ?? '',
    day1: String(item.semimonthlyDays?.[0] ?? 1),
    day2: String(item.semimonthlyDays?.[1] ?? 15),
    categoryId: item.categoryId ?? '',
    amount: magnitude(item.kind === 'bill' ? (out?.amount ?? '') : (into?.amount ?? '')),
    fromAccountId: out?.accountId ?? '',
    toAccountId: item.kind === 'bill' ? '' : (into?.accountId ?? ''),
    splits: item.kind === 'income'
      ? item.legs.map((l) => ({ accountId: l.accountId, amount: magnitude(l.amount) }))
      : [{ accountId: out?.accountId ?? into?.accountId ?? '', amount: '' }],
  }
}

/**
 * Turns the form into a request body, applying each kind's signs.
 *
 * Only shape is checked here (something to send for every field the kind
 * needs); the rules themselves — legs netting to zero, a debt payment paying a
 * card or loan, the category's kind — are the API's, and its message is shown
 * as-is, so the two can never disagree.
 *
 * @param draft - The form state.
 * @returns The body, or a message naming what is missing.
 */
export function payloadFromDraft(draft: RecurringDraft): { payload: RecurringPayload } | { error: string } {
  if (draft.name.trim() === '') return { error: 'Give it a name.' }
  if (draft.seriesStartDate === '') return { error: 'Pick the first date.' }

  let legs: RecurringPayload['legs']
  switch (draft.kind) {
    case 'income': {
      const filled = draft.splits.filter((s) => s.accountId !== '' || cleaned(s.amount) !== '')
      if (filled.length === 0 || filled.some((s) => s.accountId === '' || cleaned(s.amount) === '')) {
        return { error: 'Each part of the income needs an account and an amount.' }
      }
      legs = filled.map((s) => ({ accountId: s.accountId, amount: cleaned(s.amount) }))
      break
    }
    case 'bill':
      if (draft.fromAccountId === '' || cleaned(draft.amount) === '') {
        return { error: 'A bill needs the account that pays it and an amount.' }
      }
      legs = [{ accountId: draft.fromAccountId, amount: `-${cleaned(draft.amount)}` }]
      break
    case 'transfer':
    case 'debt_payment':
      if (draft.fromAccountId === '' || draft.toAccountId === '' || cleaned(draft.amount) === '') {
        return { error: 'Pick where the money comes from, where it goes, and how much.' }
      }
      legs = [
        { accountId: draft.fromAccountId, amount: `-${cleaned(draft.amount)}` },
        { accountId: draft.toAccountId, amount: cleaned(draft.amount) },
      ]
      break
  }

  return {
    payload: {
      name: draft.name.trim(),
      kind: draft.kind,
      frequency: draft.frequency,
      seriesStartDate: draft.seriesStartDate,
      endDate: draft.endDate === '' ? null : draft.endDate,
      semimonthlyDays: draft.frequency === 'semimonthly' ? [Number(draft.day1), Number(draft.day2)] : null,
      categoryId: (draft.kind === 'income' || draft.kind === 'bill') && draft.categoryId !== '' ? draft.categoryId : null,
      legs,
    },
  }
}

/** An amount as typed, without spaces, thousands separators or a sign. Text only: never parsed to a number. */
function cleaned(value: string): string {
  return magnitude(value.replace(/[\s,]/g, ''))
}

/** Drops a leading sign. */
function magnitude(value: string): string {
  return value.trim().replace(/^[+-]/, '')
}
