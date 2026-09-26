/**
 * Patterns for statements that change who the connection is or which
 * session settings are in force.
 *
 * Matched case-insensitively against the statement text with any run of
 * whitespace (including newlines) accepted between words. A quoted identifier
 * such as `"role"` is caught too.
 */
export const FORBIDDEN_SQL: readonly { readonly pattern: RegExp; readonly what: string }[] = [
  { pattern: /\bset_config\b/i, what: 'set_config()' },
  { pattern: /\breset\s+(?:role|all|session)\b/i, what: 'RESET' },
  { pattern: /\bset\s+"?(?:role|session|local)\b/i, what: 'SET ROLE / SESSION / LOCAL' },
  { pattern: /\bset\s+"?app\./i, what: 'SET app.*' },
  { pattern: /\bdiscard\s+all\b/i, what: 'DISCARD ALL' },
]
