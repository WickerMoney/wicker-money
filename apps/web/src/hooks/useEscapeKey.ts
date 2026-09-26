import { useEffect } from 'react'

/**
 * Calls a handler when Escape is pressed anywhere in the window.
 *
 * @param active - Whether the listener is attached at all.
 * @param onEscape - Called on each Escape keydown while active.
 */
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onEscape])
}
