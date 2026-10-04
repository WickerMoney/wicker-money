import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { NO_FORM_ERRORS, hasFormErrors, type FormErrors } from './FormErrors.js'

/** What {@link useFormErrors} returns. */
export interface FormErrorState<T extends HTMLElement> {
  /** What to show now. */
  readonly errors: FormErrors
  /** Attach to the form (or the element around its controls) so focus can move inside it. */
  readonly ref: RefObject<T | null>
  /** Shows a new set of errors, then focuses the first invalid control or the form's error. */
  readonly show: (next: FormErrors) => void
  /** Clears every message. */
  readonly clear: () => void
  /** Clears one field's message, for when its value changes. */
  readonly clearField: (field: string) => void
}

/**
 * A form's field and form-level errors, and the focus move that makes sure
 * they are seen.
 *
 * After {@link FormErrorState.show} with anything to show, focus goes to the
 * first control marked `aria-invalid` inside `ref`, or to the form's
 * {@link FormError} when no field is invalid. Moving focus also scrolls the
 * element into view, so an error never sits off-screen with nothing
 * pointing at it.
 *
 * @returns The errors and the actions on them.
 */
export function useFormErrors<T extends HTMLElement = HTMLFormElement>(): FormErrorState<T> {
  const [errors, setErrors] = useState<FormErrors>(NO_FORM_ERRORS)
  const [attempt, setAttempt] = useState(0)
  const ref = useRef<T | null>(null)

  useEffect(() => {
    if (attempt === 0 || ref.current === null) return
    const target = ref.current.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?? ref.current.querySelector<HTMLElement>('.wm-form-error')
    if (target === null) return
    target.focus()
    // Not every environment implements it (jsdom does not); focus is the part that matters.
    target.scrollIntoView?.({ block: 'nearest' })
  }, [attempt])

  const show = useCallback((next: FormErrors) => {
    setErrors(next)
    if (hasFormErrors(next)) setAttempt((a) => a + 1)
  }, [])
  const clear = useCallback(() => setErrors(NO_FORM_ERRORS), [])
  const clearField = useCallback((field: string) => {
    setErrors((current) => {
      if (!(field in current.fields)) return current
      const fields = { ...current.fields }
      delete fields[field]
      return { ...current, fields }
    })
  }, [])

  return useMemo(() => ({ errors, ref, show, clear, clearField }), [errors, show, clear, clearField])
}
