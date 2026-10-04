import { screen } from '@testing-library/react'

/**
 * The error message a labelled control is described by, as a person using a
 * screen reader would hear it after the control.
 *
 * @param label - The control's accessible name.
 * @returns The error text, or `null` when the control has none.
 */
export function errorOf(label: string): string | null {
  const control = screen.getByLabelText(label)
  const ids = (control.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id !== '')
  const error = ids.map((id) => document.getElementById(id)).find((el) => el?.className === 'wm-field__error')
  return error?.textContent ?? null
}
