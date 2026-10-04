import { hasFormErrors, type FormErrors } from '@wickermoney/ui-kit'
import { checkMoney, checkText, fieldErrors, REQUIRED_MESSAGE } from '../../../lib/fieldChecks.js'
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
 * Checks the form with the API's rules before it is sent, field by field.
 *
 * Mirrors what the API refuses so the person sees it under the field they
 * typed in: a name, a first date, an end on or after it, two different
 * semimonthly days, and for each leg an account and an amount above zero
 * (money through plugin-sdk, so a fifth decimal place is refused here too).
 * Rules that need the server's data (a debt payment paying a card or loan,
 * the category's kind) are left to it; its answer lands on the same fields
 * through {@link fieldForPath}.
 *
 * Field names: `name`, `seriesStartDate`, `endDate`, `day2`, `amount`,
 * `fromAccountId`, `toAccountId`, and `splits.<row>.accountId` /
 * `splits.<row>.amount` for income.
 *
 * @param draft - The form state.
 * @returns The problems, empty when the draft can be sent.
 */
export function checkDraft(draft: RecurringDraft): FormErrors {
  const checks: Record<string, string | undefined> = {
    name: checkText(draft.name, 200),
    seriesStartDate: draft.seriesStartDate === '' ? 'Pick the first date.' : undefined,
    endDate: draft.endDate !== '' && draft.seriesStartDate !== '' && draft.endDate < draft.seriesStartDate
      ? 'Must be on or after the first date.'
      : undefined,
    day2: draft.frequency === 'semimonthly' && draft.day1 === draft.day2 ? 'The two days must differ.' : undefined,
  }
  switch (draft.kind) {
    case 'income': {
      const filled = filledSplits(draft)
      if (filled.length === 0) {
        checks['splits.0.accountId'] = draft.splits[0]?.accountId === '' ? 'Choose an account.' : undefined
        checks['splits.0.amount'] = REQUIRED_MESSAGE
      }
      const seen = new Set<string>()
      for (const { split, row } of filled) {
        checks[`splits.${row}.accountId`] = split.accountId === ''
          ? 'Choose an account.'
          : seen.has(split.accountId) ? 'Each account may appear only once.' : undefined
        seen.add(split.accountId)
        checks[`splits.${row}.amount`] = checkMoney(cleaned(split.amount), 'positive')
      }
      break
    }
    case 'bill':
      checks['fromAccountId'] = draft.fromAccountId === '' ? 'Choose the account that pays it.' : undefined
      checks['amount'] = checkMoney(cleaned(draft.amount), 'positive')
      break
    case 'transfer':
    case 'debt_payment':
      checks['fromAccountId'] = draft.fromAccountId === '' ? 'Choose where the money comes from.' : undefined
      checks['toAccountId'] = draft.toAccountId === ''
        ? 'Choose where the money goes.'
        : draft.toAccountId === draft.fromAccountId ? 'Choose a different account from the one the money leaves.' : undefined
      checks['amount'] = checkMoney(cleaned(draft.amount), 'positive')
      break
  }
  return fieldErrors(checks)
}

/**
 * Maps a path in the API's answer to the form field it is about.
 *
 * The API names legs by position (`legs.1.amount`); which field a leg came
 * from depends on the kind: a bill's one leg is "Paid from" and "Amount", a
 * transfer's legs are From and To sharing one amount, and income's legs are
 * the filled split rows in order.
 *
 * @param draft - The form state the request was built from.
 * @returns A matcher for `formErrorsFrom`.
 */
export function fieldForPath(draft: RecurringDraft): (path: string) => string | undefined {
  return (path) => {
    // Only fields the form is showing for this draft; anything else goes
    // beside the button rather than under a field that is not there.
    if (path === 'name' || path === 'seriesStartDate') return path
    if (path === 'endDate') return draft.frequency === 'once' ? undefined : path
    if (path === 'categoryId') return draft.kind === 'income' || draft.kind === 'bill' ? path : undefined
    if (path === 'semimonthlyDays') return draft.frequency === 'semimonthly' ? 'day2' : undefined
    const leg = /^legs\.(\d+)\.(accountId|amount)$/.exec(path)
    if (leg === null) return undefined
    const index = Number(leg[1])
    const field = leg[2] as 'accountId' | 'amount'
    if (draft.kind === 'income') {
      const row = filledSplits(draft)[index]?.row
      return row === undefined ? undefined : `splits.${row}.${field}`
    }
    if (draft.kind === 'bill' && index > 0) return undefined
    if (field === 'amount') return 'amount'
    return index === 0 ? 'fromAccountId' : 'toAccountId'
  }
}

/**
 * Turns a checked form into a request body, applying each kind's signs.
 *
 * Run {@link checkDraft} first: this assumes every field it needs is there.
 *
 * @param draft - The form state.
 * @returns The body, or the problems {@link checkDraft} found.
 */
export function payloadFromDraft(draft: RecurringDraft): { payload: RecurringPayload } | { errors: FormErrors } {
  const errors = checkDraft(draft)
  if (hasFormErrors(errors)) return { errors }

  let legs: RecurringPayload['legs']
  switch (draft.kind) {
    case 'income':
      legs = filledSplits(draft).map(({ split }) => ({ accountId: split.accountId, amount: cleaned(split.amount) }))
      break
    case 'bill':
      legs = [{ accountId: draft.fromAccountId, amount: `-${cleaned(draft.amount)}` }]
      break
    case 'transfer':
    case 'debt_payment':
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

/** Income rows with anything typed or chosen, with their position in the form. A wholly blank row is ignored. */
function filledSplits(draft: RecurringDraft): { split: RecurringDraft['splits'][number]; row: number }[] {
  return draft.splits
    .map((split, row) => ({ split, row }))
    .filter(({ split }) => split.accountId !== '' || cleaned(split.amount) !== '')
}

/** An amount as typed, without spaces, thousands separators or a sign. Text only: never parsed to a number. */
function cleaned(value: string): string {
  return magnitude(value.replace(/[\s,]/g, ''))
}

/** Drops a leading sign. */
function magnitude(value: string): string {
  return value.trim().replace(/^[+-]/, '')
}
