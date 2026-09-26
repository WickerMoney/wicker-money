import type { Writable } from 'node:stream'
import type { ExportSink } from '../../service/ExportSink.js'

/**
 * Adapts a writable stream to an {@link ExportSink} that respects backpressure.
 *
 * A write resolves immediately while the stream's buffer has room and
 * otherwise waits for it to drain. If the stream closes first (the client
 * went away) the write rejects, which abandons the export and releases the
 * database transaction instead of leaving it open behind a dead connection.
 *
 * @param stream - The stream the response body is read from.
 * @returns A sink writing to `stream`.
 */
export function createStreamSink(stream: Writable): ExportSink {
  return {
    write(chunk) {
      if (stream.destroyed) return Promise.reject(new Error('The export consumer went away.'))
      if (stream.write(chunk)) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        const settle = (error?: Error): void => {
          stream.off('drain', onDrain)
          stream.off('close', onClose)
          if (error === undefined) resolve()
          else reject(error)
        }
        const onDrain = (): void => settle()
        const onClose = (): void => settle(new Error('The export consumer went away.'))
        stream.once('drain', onDrain)
        stream.once('close', onClose)
      })
    },
  }
}
