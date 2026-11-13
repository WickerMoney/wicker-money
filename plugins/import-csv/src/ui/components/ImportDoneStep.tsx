import { useEffect, useRef } from 'react'
import { Button, Surface } from '@wickermoney/ui-kit'
import type { ImportResult } from '../models/index.js'

/** Props for {@link ImportDoneStep}. */
export interface ImportDoneStepProps {
  readonly result: ImportResult
  readonly onReset: () => void
}

/**
 * Step four of the import: what was written, and a way to start over.
 *
 * The result replaces a long review, so it can appear far from where the window
 * is scrolled to (and a page frame is as tall as the page: the window scrolls,
 * not the frame). It scrolls itself into view, the least that shows it.
 */
export function ImportDoneStep({ result, onReset }: ImportDoneStepProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  return (
    <div ref={ref}>
      <Surface title="4 · Imported">
        <p className="imp__done" role="status">
          <strong>{result.imported}</strong> transactions imported
          {result.skipped > 0 ? `, ${result.skipped} already present` : ''}
          {result.flagged > 0 ? `, ${result.flagged} flagged` : ''}
          {result.failed > 0 ? `, ${result.failed} unreadable` : ''}.
        </p>
        <Button variant="primary" onClick={onReset}>Import another file</Button>
      </Surface>
    </div>
  )
}
