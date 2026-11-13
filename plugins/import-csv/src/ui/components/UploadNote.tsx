import type { UploadStatus } from '../hooks/useImportFlow.js'

/** Props for {@link UploadNote}. */
export interface UploadNoteProps {
  readonly upload: UploadStatus
}

/**
 * Says that the file is on its way to the server, and when it has arrived.
 *
 * The words change only when the phase does, so a screen reader hears two
 * short messages and not one per chunk; the bar carries the count. A failure
 * is not shown here: it is a section message ({@link SectionNotice}).
 */
export function UploadNote({ upload }: UploadNoteProps) {
  if (upload.phase === 'uploading') {
    return (
      <>
        <span className="imp__hint" role="status">Sending your file to the server. You can set the columns meanwhile.</span>
        <progress className="imp__progress" max={upload.total} value={upload.sent} aria-label="Sending your file to the server" />
      </>
    )
  }
  if (upload.phase === 'ready') return <span className="imp__hint" role="status">Your file is on the server.</span>
  return null
}
