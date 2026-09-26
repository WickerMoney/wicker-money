/**
 * Converts a display name into the kebab-case slug the API requires.
 *
 * @param name - The category name as typed.
 * @returns Lowercase alphanumerics separated by single hyphens, at most 100
 *   characters, with no leading or trailing hyphen.
 * @example
 * slugify('Eating Out & Coffee') // 'eating-out-coffee'
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}
