/** Why staging a file failed, for the code that decides what to say and do. */
export type StagingFailureKind =
  /** The file cannot be sent at all: over 8 MB, or in more pieces than the server accepts. */
  | 'too_big'
  /** The server is holding all the staged files it allows. Try later. */
  | 'busy'
  /** The person already has the most uploads waiting. */
  | 'too_many'
  /** The server lost the upload (expired or unknown), and sending it again did not help. */
  | 'gone'
  /** The server refused what arrived and discarded the upload; start again. */
  | 'restart'
  /** A request kept failing: the connection, or the server. */
  | 'interrupted'
  /** The person chose another file or left. Not shown. */
  | 'cancelled'

/** A file could not be staged, with something a person can be told. */
export class StagingFailure extends Error {
  readonly kind: StagingFailureKind

  constructor(kind: StagingFailureKind, message: string) {
    super(message)
    this.name = 'StagingFailure'
    this.kind = kind
  }
}
