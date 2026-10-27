/**
 * The toasts on screen right now, as a person reads them: kind word first for
 * a warning or an error ("Error: ..."), newest first. The announcer's copy of
 * the text is not counted.
 *
 * @returns The text of each visible toast.
 */
export function shownToasts(): string[] {
  return [...document.querySelectorAll('.wm-toast__text')].map((el) => el.textContent ?? '')
}
