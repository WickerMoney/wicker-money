import { useState, type FormEvent } from 'react'
import { Button, FormError, hasFormErrors, useFormErrors, type FormErrors } from '@wickermoney/ui-kit'
import type { WhatIfResult } from '../../shared/index.js'
import { EMPTY_LUMP_DRAFT } from '../helpers/EMPTY_LUMP_DRAFT.js'
import { whatIfSentence } from '../helpers/whatIfSentence.js'
import type { Debt, LumpSumDraft } from '../models/index.js'
import { LumpSumFields } from './LumpSumFields.js'

/** Props for {@link WhatIfForm}. */
export interface WhatIfFormProps {
  readonly debts: readonly Debt[]
  readonly busy: boolean
  readonly formatMoney: (value: string) => string
  readonly formatDate: (value: string) => string
  /** Works the what-if out; resolves to the problems by field, or the result. */
  readonly onPreview: (draft: LumpSumDraft) => Promise<{ readonly errors: FormErrors; readonly result: WhatIfResult | null }>
  /** Saves the same lump sum for real; resolves to the problems by field, or no errors. */
  readonly onSave: (draft: LumpSumDraft) => Promise<FormErrors>
}

/**
 * "What if I paid this much on this day?" Shows the debt-free date and the
 * interest it would save against the plan as it stands, and saves nothing until
 * the person says so.
 *
 * The answer is a sentence below the button, and the page's live region says
 * the same, so a screen reader hears it without looking for it. Focus stays on
 * the button that asked.
 */
export function WhatIfForm({ debts, busy, formatMoney, formatDate, onPreview, onSave }: WhatIfFormProps) {
  const [draft, setDraft] = useState<LumpSumDraft>(EMPTY_LUMP_DRAFT)
  const [shown, setShown] = useState<{ sentence: string; stale: boolean } | null>(null)
  const { errors, ref, show, clearField } = useFormErrors<HTMLFormElement>()

  const change = (patch: Partial<LumpSumDraft>, field?: string) => {
    setDraft((d) => ({ ...d, ...patch }))
    if (field !== undefined) clearField(field)
    // What was shown answers the numbers that were typed, not these.
    setShown((s) => (s === null ? s : { ...s, stale: true }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const { errors: problems, result } = await onPreview(draft)
    if (hasFormErrors(problems)) { setShown(null); show(problems); return }
    if (result !== null) setShown({ sentence: whatIfSentence(result, formatMoney, formatDate), stale: false })
  }

  const save = async () => {
    const problems = await onSave(draft)
    if (hasFormErrors(problems)) { show(problems); return }
    setDraft(EMPTY_LUMP_DRAFT)
    setShown(null)
  }

  return (
    <form className="dp-whatif" onSubmit={(e) => void submit(e)} ref={ref} noValidate aria-label="What if">
      <LumpSumFields draft={draft} debts={debts} error={(f) => errors.fields[f]} onChange={change} withNote={false} />
      <div className="dp-whatif__actions">
        <Button type="submit" busy={busy}>Show what it changes</Button>
        {shown !== null && !shown.stale ? <Button onClick={() => void save()} busy={busy}>Save as a lump sum</Button> : null}
        <FormError message={errors.form} />
      </div>
      {shown !== null ? (
        <p className={shown.stale ? 'dp-whatif__result dp-muted' : 'dp-whatif__result'} data-testid="what-if-result">
          {shown.stale ? 'Out of date, because you changed the numbers. Run it again. ' : ''}{shown.sentence}
        </p>
      ) : null}
    </form>
  )
}
