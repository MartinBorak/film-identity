/**
 * The outside service a failure came from, so a caller can tell an outage from a bad listing and
 * a supplement's failure can cost one title rather than the run.
 */
export type FilmLookupSource = 'tmdb' | 'wikidata' | 'model' | 'poster'

/**
 * Values that survive serialization to an error tracker. Undefined is allowed so a field the
 * catalogue lacked can be recorded as missing.
 */
type Loggable =
  string | number | boolean | null | undefined | Loggable[] | { [key: string]: Loggable }

export type FilmLookupErrorContext = Record<string, Loggable>

export class FilmLookupError extends Error {
  readonly source: FilmLookupSource
  readonly context: FilmLookupErrorContext

  /**
   * Creates an error that records which service failed and the details needed to debug it.
   */
  constructor(message: string, source: FilmLookupSource, context: FilmLookupErrorContext = {}) {
    super(message)
    this.name = 'FilmLookupError'
    this.source = source
    this.context = context
  }
}
