/**
 * The text a control is described by (`aria-describedby`), as a screen reader
 * would read it after the control's name.
 */
export function descriptionOf(element: Element): string {
  const ids = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
  return ids.map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '').join(' ')
}
