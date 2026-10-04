import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  Field, FormError, NO_FORM_ERRORS, SelectField, formErrorsFrom, hasFormErrors, useFormErrors,
  validationIssuesOf, type FormErrorState,
} from './index.js'

/** An error shaped like the API client's: a message plus the server's issues. */
function apiError(message: string, issues: unknown): Error {
  return Object.assign(new Error(message), { issues })
}

describe('validationIssuesOf', () => {
  it('reads issues off any error that carries them', () => {
    const issues = [{ path: ['amount'], message: 'Must be more than 0.' }]
    expect(validationIssuesOf(apiError('amount: Must be more than 0.', issues))).toEqual(issues)
  })

  it('ignores errors without issues, and entries of the wrong shape', () => {
    expect(validationIssuesOf(new Error('offline'))).toEqual([])
    expect(validationIssuesOf('boom')).toEqual([])
    expect(validationIssuesOf(apiError('x', [{ path: 'amount', message: 'no' }, { path: [], message: 'kept' }])))
      .toEqual([{ path: [], message: 'kept' }])
  })
})

describe('formErrorsFrom', () => {
  it('puts each issue on the field its path names, and the rest on the form', () => {
    const error = apiError('…', [
      { path: ['conditions', 0, 'amountMin'], message: 'Must be more than 0. Leave it empty for no minimum.' },
      { path: ['priority'], message: 'Must be a whole number.' },
      { path: [], message: 'A rule needs at least one condition.' },
    ])

    expect(formErrorsFrom(error, ['conditions.0.amountMin'], 'Could not save.')).toEqual({
      fields: { 'conditions.0.amountMin': 'Must be more than 0. Leave it empty for no minimum.' },
      form: 'Must be a whole number. A rule needs at least one condition.',
    })
  })

  it('maps paths through a function', () => {
    const error = apiError('…', [{ path: ['legs', 0, 'amount'], message: 'Must be more than 0.' }])

    expect(formErrorsFrom(error, (p) => (p.startsWith('legs.') ? 'amount' : undefined), 'x').fields)
      .toEqual({ amount: 'Must be more than 0.' })
  })

  it('keeps the first message for a field', () => {
    const error = apiError('…', [
      { path: ['name'], message: 'First.' },
      { path: ['name'], message: 'Second.' },
    ])
    expect(formErrorsFrom(error, ['name'], 'x').fields).toEqual({ name: 'First.' })
  })

  it("shows an error without issues on the form, in its own words or the fallback's", () => {
    expect(formErrorsFrom(new Error("You already have a category called 'Food'."), ['name'], 'x'))
      .toEqual({ fields: {}, form: "You already have a category called 'Food'." })
    expect(formErrorsFrom(undefined, ['name'], 'Could not save.')).toEqual({ fields: {}, form: 'Could not save.' })
  })
})

describe('hasFormErrors', () => {
  it('is false only when nothing is wrong', () => {
    expect(hasFormErrors(NO_FORM_ERRORS)).toBe(false)
    expect(hasFormErrors({ fields: { a: 'x' }, form: null })).toBe(true)
    expect(hasFormErrors({ fields: {}, form: 'x' })).toBe(true)
  })
})

describe('Field and SelectField', () => {
  it('describe the control by its hint and its error', () => {
    render(<Field label="At least" hint="Leave empty for no minimum." error="Must be more than 0." />)
    const input = screen.getByLabelText('At least')
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ')

    expect(ids.map((id) => document.getElementById(id)?.textContent))
      .toEqual(['Leave empty for no minimum.', 'Must be more than 0.'])
  })

  it('wire a select to its error the same way', () => {
    render(<SelectField label="To account" error="Choose an account."><option>a</option></SelectField>)
    const select = screen.getByLabelText('To account')

    expect(select.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(select.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Choose an account.')
  })
})

/** A two-field form wired to the hook, exposing its state to the test. */
function Harness({ onState }: { onState: (s: FormErrorState<HTMLFormElement>) => void }) {
  const state = useFormErrors()
  onState(state)
  return (
    <form ref={state.ref}>
      <Field label="Name" error={state.errors.fields['name']} />
      <Field label="Amount" error={state.errors.fields['amount']} />
      <button type="submit">Save</button>
      <FormError message={state.errors.form} />
    </form>
  )
}

describe('useFormErrors', () => {
  it('focuses the first invalid field', () => {
    let state!: FormErrorState<HTMLFormElement>
    render(<Harness onState={(s) => { state = s }} />)

    act(() => state.show({ fields: { amount: 'Must be more than 0.' }, form: null }))

    expect(document.activeElement).toBe(screen.getByLabelText('Amount'))
  })

  it('focuses the form error, next to the action, when no field is to blame', () => {
    let state!: FormErrorState<HTMLFormElement>
    render(<Harness onState={(s) => { state = s }} />)

    act(() => state.show({ fields: {}, form: 'That name is taken.' }))

    expect(document.activeElement).toBe(screen.getByRole('alert'))
    expect(screen.getByRole('alert').textContent).toBe('That name is taken.')
  })

  it('clears one field without touching the rest', () => {
    let state!: FormErrorState<HTMLFormElement>
    render(<Harness onState={(s) => { state = s }} />)

    act(() => state.show({ fields: { name: 'This cannot be empty.', amount: 'Must be more than 0.' }, form: null }))
    act(() => state.clearField('amount'))

    expect(state.errors.fields).toEqual({ name: 'This cannot be empty.' })
  })
})
