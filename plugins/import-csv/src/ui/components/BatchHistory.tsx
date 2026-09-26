import { useCallback, useEffect, useState } from 'react'
import type { PluginContext } from '@wickermoney/plugin-sdk'
import { Alert, Button, EmptyState, Spinner, Surface } from '@wickermoney/ui-kit'
import { IMPORT_API_BASE } from '../../server/constants.js'
import type { Batch } from '../models/index.js'

/** Props for {@link BatchHistory}. */
export interface BatchHistoryProps {
  readonly ctx: PluginContext
  /** Changing this value reloads the history. */
  readonly refreshKey: number
  /** Called after an import is undone. */
  readonly onReverted: () => void
}

/**
 * Lists past imports, each of which can be undone.
 *
 * Undo needs to know which ledger rows a given run created. The core ledger does
 * not record that, because a batch column there would make the core depend on a
 * plugin being installed; the plugin's own join table keeps the dependency
 * pointing one way and turns a bad import into a button.
 */
export function BatchHistory({ ctx, refreshKey, onReverted }: BatchHistoryProps) {
  const [batches, setBatches] = useState<readonly Batch[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reverting, setReverting] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ctx.api
      .get<{ batches: Batch[] }>(`${IMPORT_API_BASE}/batches`)
      .then((r) => {
        if (live) setBatches(r.batches)
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : 'Could not load import history.')
      })
    return () => {
      live = false
    }
  }, [ctx, refreshKey])

  const revert = useCallback(
    async (id: string) => {
      setReverting(id)
      setError(null)
      setNotice(null)
      try {
        const r = await ctx.api.post<{ reverted: number; skipped: number }>(
          `${IMPORT_API_BASE}/batches/${id}/revert`,
          {},
        )
        if (r.skipped > 0) {
          setNotice(
            `${r.skipped} transaction${r.skipped === 1 ? ' was' : 's were'} kept because ` +
              `you had changed ${r.skipped === 1 ? 'it' : 'them'} since the import.`,
          )
        }
        onReverted()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not undo that import.')
      } finally {
        setReverting(null)
      }
    },
    [ctx, onReverted],
  )

  return (
    <Surface title="Recent imports">
      {error !== null ? <Alert>{error}</Alert> : null}
      {notice !== null ? <p className="imp__hint">{notice}</p> : null}
      {batches === null ? (
        <Spinner label="Loading import history" />
      ) : batches.length === 0 ? (
        <EmptyState title="No imports yet" hint="Imported files appear here and can be undone." />
      ) : (
        <table className="imp__table">
          <thead>
            <tr>
              <th>When</th><th>Source</th><th>Account</th>
              <th className="num">Imported</th><th className="num">Skipped</th><th />
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} className={b.revertedAt !== null ? 'imp__reverted' : undefined}>
                <td>{ctx.formatDate(b.createdAt)}</td>
                <td>
                  {b.sourceName}
                  <span className="imp__muted"> · {b.fileName}</span>
                </td>
                <td>{b.accountName}</td>
                <td className="num">{b.rowsImported}</td>
                <td className="num">{b.rowsSkipped}</td>
                <td>
                  {b.revertedAt !== null ? (
                    <span className="imp__muted">Undone</span>
                  ) : (
                    <Button
                      disabled={reverting === b.id}
                      onClick={() => void revert(b.id)}
                    >
                      {reverting === b.id ? 'Undoing…' : 'Undo'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Surface>
  )
}
