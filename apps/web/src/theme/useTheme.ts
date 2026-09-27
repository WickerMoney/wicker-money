import { useCallback, useEffect, useState } from 'react'
import { applyTheme } from './applyTheme.js'
import type { ThemePreference } from './ThemePreference.js'
import { readThemePreference, writeThemePreference } from './themeStorage.js'

/** What {@link useTheme} returns. */
export interface ThemeState {
  /** The current choice. */
  readonly preference: ThemePreference
  /** Applies a new choice to the document and remembers it. */
  readonly setPreference: (next: ThemePreference) => void
}

/**
 * The user's theme choice: its current value, and a setter that applies it to
 * the document and remembers it in this browser.
 */
export function useTheme(): ThemeState {
  const [preference, setState] = useState<ThemePreference>(readThemePreference)

  // Applied in an effect so the document matches the state on first render too,
  // covering the case where the inline script in index.html did not run.
  useEffect(() => { applyTheme(preference) }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    setState(next)
    writeThemePreference(next)
  }, [])

  return { preference, setPreference }
}
