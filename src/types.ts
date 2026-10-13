/**
 * A film as the catalogues describe it.
 * Any id can be null, since a film can be missing from any catalogue.
 */
export type Film = {
  tmdbId: number | null
  imdbId: string | null
  wikidataId: string | null
  /** Further Wikidata ids, keyed by the configured property, such as P2529 for ČSFD. */
  catalogueIds: Record<string, string>
  /** In the configured TMDB language. */
  title: string
  /** The original title where nobody translated it. */
  englishTitle: string
  originalTitle: string
  releaseYear: number | null
  runtimeMinutes: number | null
  /** Relative to TMDB's image base URL. */
  posterPath: string | null
  /** Empty means unknown, not none. */
  directors: string[]
  /** TMDB genre ids; empty for a film read from Wikidata. */
  genreIds: number[]
}

/**
 * Everything the cinemas printed about one film, pooled across cinemas.
 */
export type Listing = {
  /** One per spelling the cinemas used. */
  titles: string[]
  originalTitles?: string[]
  /** The year of the earliest screening. */
  screeningYear: number
  /** YYYY-MM-DD. */
  firstScreeningDate?: `${number}-${number}-${number}`
  productionYears?: number[]
  directors?: string[]
  runtimesInMinutes?: number[]
  synopses?: string[]
  posterUrls?: string[]
}

/**
 * The film a listing resolved to, and the evidence that admitted it.
 */
export type FilmMatch =
  | { evidence: 'title' | 'director' | 'poster' | 'model'; film: Film }
  | { evidence: 'unmatched'; film: null }
