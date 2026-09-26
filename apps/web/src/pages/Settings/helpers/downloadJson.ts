/**
 * Starts a browser download of a value as a pretty-printed JSON file.
 *
 * @param data - Any JSON-serializable value.
 * @param filename - The name the browser saves the file under.
 */
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
