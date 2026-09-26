import { DEFAULT_RANGE_KEY, isRangeKey, type RangeKey } from '@wickermoney/plugin-sdk'

const STORAGE_KEY = 'wickermoney.dashboard.range'

/**
 * Reads the dashboard range the user last chose.
 *
 * @returns The remembered range, or the default when nothing valid is stored or
 *   storage is unavailable. Private windows and blocked site data throw on
 *   access rather than returning `null`, and a dashboard that will not render
 *   because of a remembered filter is a bad trade.
 */
export function storedRange(): RangeKey {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return saved !== null && isRangeKey(saved) ? saved : DEFAULT_RANGE_KEY
  } catch {
    return DEFAULT_RANGE_KEY
  }
}

/**
 * Remembers the dashboard range across visits. Failure is silently ignored,
 * since remembering the choice is a convenience rather than a requirement.
 *
 * @param key - The range to remember.
 */
export function rememberRange(key: RangeKey): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, key)
  } catch {
    // Storage unavailable; the choice simply is not remembered.
  }
}
