import { Alert, Button } from '@wickermoney/ui-kit'
import { useDataExport } from '../hooks/useDataExport.js'

/** Props for {@link ExportFirst}. */
export interface ExportFirstProps {
  /** What the download does and does not contain, shown above the button. */
  readonly children: string
}

/** "Download my data first": the export, offered inside an erase dialog before anything is deleted. */
export function ExportFirst({ children }: ExportFirstProps) {
  const { busy, error, done, run } = useDataExport()
  return (
    <div className="danger-export">
      <p className="form-hint">{children}</p>
      {error !== null ? <Alert>{error}</Alert> : null}
      <Button onClick={() => { void run() }} disabled={busy}>
        {busy ? 'Preparing export…' : 'Download my data first'}
      </Button>
      {done ? <span className="wm-muted" role="status">Downloaded.</span> : null}
    </div>
  )
}
