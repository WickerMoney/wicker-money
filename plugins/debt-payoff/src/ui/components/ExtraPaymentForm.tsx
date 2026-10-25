import { useEffect, useState, type FormEvent } from 'react'
import { editableMoney } from '@wickermoney/plugin-sdk/money'
import { Button, Field, FormError, hasFormErrors, useFormErrors, type FormErrors } from '@wickermoney/ui-kit'

/** Props for {@link ExtraPaymentForm}. */
export interface ExtraPaymentFormProps {
  /** The saved extra, as the API returns it. */
  readonly saved: string
  readonly busy: boolean
  /** Saves the typed amount; resolves to the problem to show, or no errors. */
  readonly onApply: (text: string) => Promise<FormErrors>
}

/**
 * The extra paid each month on top of the minimums, shared by every debt in the
 * plan: the strategy decides which debt it goes to first. (An amount for one
 * particular debt is set on that debt.)
 *
 * The typed text lives here and not in the page, so typing re-renders this
 * form and nothing else: the debt list and the chart are not redrawn per
 * keystroke. The plan changes when the amount is applied.
 */
export function ExtraPaymentForm({ saved, busy, onApply }: ExtraPaymentFormProps) {
  const [text, setText] = useState(() => editableMoney(saved))
  const { errors, ref, show, clearField } = useFormErrors<HTMLFormElement>()

  // The saved amount is the source of truth; follow it when it changes.
  useEffect(() => { setText(editableMoney(saved)) }, [saved])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const result = await onApply(text)
    if (hasFormErrors(result)) show(result)
  }

  return (
    <form className="dp-extra" onSubmit={(e) => void submit(e)} ref={ref} noValidate>
      <Field
        label="Extra for all debts (follows the strategy)"
        hint="On top of your minimums, aimed at one debt at a time by the strategy. Enter 0 for none. To pay extra toward one particular debt, set it on that debt."
        inputMode="decimal"
        autoComplete="off"
        value={text}
        error={errors.fields['extraPayment']}
        onChange={(e) => { setText(e.target.value); clearField('extraPayment') }}
      />
      <div className="dp-extra__action">
        <Button type="submit" disabled={busy}>Update plan</Button>
        <FormError message={errors.form} />
      </div>
    </form>
  )
}
