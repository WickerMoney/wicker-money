/**
 * Forms in a sandboxed plugin frame.
 *
 * The frame's sandbox has `allow-scripts` and nothing else (ADR 0014), so the
 * browser refuses to submit a form: it blocks the submission before the
 * `submit` event is even dispatched, and a React `onSubmit` never runs. A
 * plugin form that only wants to read its fields and call `ctx.api` would be
 * dead.
 *
 * This restores the event, and nothing more. A click on a submit button, or
 * Enter in a field, is taken over (the browser's own submission is cancelled),
 * the form's constraints are checked as the browser would, and a cancelable
 * `submit` event is dispatched on the form. Nothing navigates and nothing
 * leaves the frame: the sandbox is unchanged, and a form that is not handled
 * by a script still does nothing, as it did before.
 */

function isSubmitter(el: Element | null): el is HTMLButtonElement | HTMLInputElement {
  if (el === null) return false
  if (el instanceof HTMLButtonElement) return el.type === 'submit'
  return el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'image')
}

/** Submits as the browser would, minus navigation. */
export function submitForm(form: HTMLFormElement, submitter: HTMLElement | null): void {
  if (!form.noValidate && !(submitter as HTMLButtonElement | null)?.formNoValidate && !form.checkValidity()) {
    form.reportValidity()
    return
  }
  const init = { bubbles: true, cancelable: true, submitter } as SubmitEventInit
  form.dispatchEvent(typeof SubmitEvent === 'function' ? new SubmitEvent('submit', init) : new Event('submit', init))
}

/** Starts it for a document; returns the function that stops it. */
export function startFormSubmit(doc: Document = document): () => void {
  const onClick = (event: Event): void => {
    if (event.defaultPrevented) return
    const target = event.target as Element | null
    const button = target?.closest('button, input') ?? null
    if (!isSubmitter(button) || button.disabled || button.form === null) return
    event.preventDefault()
    submitForm(button.form, button)
  }
  const onKeydown = (event: Event): void => {
    const e = event as KeyboardEvent
    if (e.defaultPrevented || e.key !== 'Enter' || e.isComposing || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return
    const target = e.target as Element | null
    if (!(target instanceof HTMLInputElement) || target.form === null) return
    // Buttons and links act on Enter themselves; only fields start an implicit submission.
    if (['button', 'submit', 'reset', 'image', 'file', 'range', 'color'].includes(target.type)) return
    const form = target.form
    const def = [...form.elements].find((el) => isSubmitter(el)) as HTMLButtonElement | HTMLInputElement | undefined
    if (def !== undefined && def.disabled) { e.preventDefault(); return }
    // With no submit button, the browser submits only when one field could be edited.
    if (def === undefined && [...form.elements].filter((el) => el instanceof HTMLInputElement && !['checkbox', 'radio', 'hidden', 'button', 'reset'].includes(el.type)).length > 1) return
    e.preventDefault()
    submitForm(form, def ?? null)
  }
  doc.addEventListener('click', onClick)
  doc.addEventListener('keydown', onKeydown)
  return () => { doc.removeEventListener('click', onClick); doc.removeEventListener('keydown', onKeydown) }
}
