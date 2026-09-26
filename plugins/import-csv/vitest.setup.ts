import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// @testing-library/react auto-cleans only when vitest `globals` is enabled.
afterEach(cleanup)

// jsdom 26 has no Blob.text(); every browser does, and useImportFlow relies on
// it to read the chosen file. Delete this once jsdom is back on a version that
// implements it.
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text(this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(this)
    })
  }
}
