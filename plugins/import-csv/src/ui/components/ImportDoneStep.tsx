import { Button, Surface } from '@wickermoney/ui-kit'
import type { ImportResult } from '../models/index.js'

/** Props for {@link ImportDoneStep}. */
export interface ImportDoneStepProps {
  readonly result: ImportResult
  readonly onReset: () => void
}

/** Step four of the import: what was written, and a way to start over. */
export function ImportDoneStep({ result, onReset }: ImportDoneStepProps) {
  return (
    <Surface title="4 · Imported">
      <p className="imp__done">
        <strong>{result.imported}</strong> transactions imported
        {result.skipped > 0 ? `, ${result.skipped} already present` : ''}
        {result.flagged > 0 ? `, ${result.flagged} flagged` : ''}
        {result.failed > 0 ? `, ${result.failed} unreadable` : ''}.
      </p>
      <Button variant="primary" onClick={onReset}>Import another file</Button>
    </Surface>
  )
}
