/** Where an export's JSON text is written as it is produced. */
export interface ExportSink {
  /**
   * Accepts the next piece of the document.
   *
   * The returned promise resolves once the consumer is ready for more, which
   * is how a slow client holds back the database reads instead of letting the
   * document pile up in memory.
   *
   * @param chunk - The next piece of JSON text.
   * @throws When the consumer has gone away; the export is abandoned.
   */
  write(chunk: string): Promise<void>
}
