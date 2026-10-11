/**
 * Whether what was typed is the confirmation phrase, ignoring case and the
 * spaces around it, as the server does.
 *
 * @param typed - The field's current text.
 * @param phrase - The phrase that was asked for.
 */
export function matchesPhrase(typed: string, phrase: string): boolean {
  return typed.trim().toLowerCase() === phrase
}
