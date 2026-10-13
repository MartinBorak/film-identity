import { z } from 'zod'

import type { Context, TmdbContext } from '../config.js'
import type { Film } from '../types.js'
import { isNonEmpty, unique } from '../utils.js'
import { FilmLookupError } from './errors.js'
import { fetchJson } from './http.js'

// v3 paths, authenticated with a v4 read access token.
const TMDB_BASE_URL = 'https://api.themoviedb.org/3'

/**
 * Builds a TMDB API address from a path and query parameters.
 */
function buildTmdbUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(`${TMDB_BASE_URL}${path}`)

  url.search = new URLSearchParams(params).toString()

  return url.toString()
}

/**
 * Builds the address that searches TMDB for films matching a query.
 * TMDB matches titles in any language, so one search per title is enough; `language` and
 * `region` only localize the results.
 */
export function buildTmdbSearchUrl(tmdbContext: TmdbContext, query: string): string {
  const { language, region } = tmdbContext

  return buildTmdbUrl('/search/movie', {
    query,
    language,
    ...(region === null ? {} : { region }),
  })
}

/**
 * Builds the address for a film's full details, with its translated and alternative titles and
 * its credits. Both title sets are needed: a neighbouring language's title can be in
 * `translations` but not in `alternative_titles`.
 */
export function buildTmdbMovieUrl(tmdbContext: TmdbContext, movieId: number): string {
  return buildTmdbUrl(`/movie/${movieId}`, {
    language: tmdbContext.language,
    append_to_response: 'translations,alternative_titles,credits',
  })
}

/**
 * Builds the address listing every poster TMDB has for a film.
 * No language filter, since an opera relay's only poster may be German.
 */
export function buildTmdbImagesUrl(movieId: number): string {
  return buildTmdbUrl(`/movie/${movieId}/images`)
}

// Enough detail for an image hash at a few kilobytes per poster.
const TMDB_POSTER_WIDTH = 'w342'

/**
 * Builds the download address of a poster, at a small size that is enough to compare posters.
 */
export function buildTmdbPosterUrl(posterPath: string): string {
  return `https://image.tmdb.org/t/p/${TMDB_POSTER_WIDTH}${posterPath}`
}

/**
 * Builds the address that searches TMDB for people by name.
 * No region, since it only localizes release dates.
 */
export function buildTmdbPersonSearchUrl(tmdbContext: TmdbContext, name: string): string {
  return buildTmdbUrl('/search/person', { query: name, language: tmdbContext.language })
}

/**
 * Builds the address listing every film a person worked on.
 */
export function buildTmdbPersonCreditsUrl(tmdbContext: TmdbContext, personId: number): string {
  return buildTmdbUrl(`/person/${personId}/movie_credits`, { language: tmdbContext.language })
}

// TMDB omits the field entirely when it has no date, on credits as on films.
const releaseDateSchema = z.string().optional()

const tmdbSearchResultSchema = z.object({
  id: z.number(),
  title: z.string(),
  original_title: z.string(),
  release_date: releaseDateSchema,
})

const tmdbSearchResponseSchema = z.object({ results: z.array(tmdbSearchResultSchema) })

const tmdbMovieSchema = z.object({
  id: z.number(),
  title: z.string(),
  original_title: z.string(),
  release_date: releaseDateSchema,
  imdb_id: z.string().nullable(),
  runtime: z.number().nullable(),
  // Often null for older and minor titles.
  poster_path: z.string().nullable(),
  // Blank where TMDB has none in the configured language.
  overview: z.string().default(''),
  original_language: z.string().default(''),
  translations: z.object({
    translations: z.array(
      z.object({ iso_639_1: z.string(), data: z.object({ title: z.string() }) }),
    ),
  }),
  alternative_titles: z.object({ titles: z.array(z.object({ title: z.string() })) }),
  credits: z.object({
    crew: z.array(z.object({ job: z.string(), name: z.string() })),
    cast: z.array(z.object({ name: z.string(), order: z.number() })).default([]),
  }),
  genres: z.array(z.object({ id: z.number(), name: z.string() })),
})

const tmdbImagesResponseSchema = z.object({
  posters: z.array(z.object({ file_path: z.string(), iso_639_1: z.string().nullable() })),
})

const tmdbPersonSchema = z.object({ id: z.number(), name: z.string() })

const tmdbPersonSearchResponseSchema = z.object({ results: z.array(tmdbPersonSchema) })

// TMDB repeats a credit once per job the person held on the film.
const tmdbCrewCreditSchema = z.object({
  id: z.number(),
  job: z.string(),
  release_date: releaseDateSchema,
})

const tmdbMovieCreditsResponseSchema = z.object({ crew: z.array(tmdbCrewCreditSchema) })

export type TmdbSearchResult = z.infer<typeof tmdbSearchResultSchema>
export type TmdbMovie = z.infer<typeof tmdbMovieSchema>
export type TmdbPerson = z.infer<typeof tmdbPersonSchema>
export type TmdbCrewCredit = z.infer<typeof tmdbCrewCreditSchema>

/**
 * Returns the configured TMDB token, or fails with a pointer to where to get one.
 */
function requireTmdbToken(tmdbContext: TmdbContext): string {
  if (tmdbContext.readAccessToken === '') {
    throw new FilmLookupError(
      'No TMDB read access token configured; get one at https://www.themoviedb.org/settings/api',
      'tmdb',
    )
  }

  return tmdbContext.readAccessToken
}

/**
 * Fetches from the TMDB API and checks that the response has the expected shape.
 */
export async function fetchTmdb<T>(
  context: Context,
  url: string,
  schema: z.ZodType<T>,
): Promise<T> {
  return fetchJson(context, url, 'tmdb', schema, {
    authorization: `Bearer ${requireTmdbToken(context.tmdb)}`,
  })
}

/**
 * Searches TMDB for films matching a query.
 * Results come in TMDB's ranking, which often puts the wanted film below others.
 */
export async function fetchTmdbSearchResults(
  context: Context,
  query: string,
): Promise<TmdbSearchResult[]> {
  const response = await fetchTmdb(
    context,
    buildTmdbSearchUrl(context.tmdb, query),
    tmdbSearchResponseSchema,
  )

  return response.results
}

/**
 * Fetches a film's full details from TMDB by its id.
 */
export async function fetchTmdbMovie(context: Context, movieId: number): Promise<TmdbMovie> {
  return fetchTmdb(context, buildTmdbMovieUrl(context.tmdb, movieId), tmdbMovieSchema)
}

/**
 * Ranks a poster's language by the configured preference, putting unlisted languages last.
 */
function toPosterLanguageRank(context: Context, language: string | null): number {
  const rank = context.posterLanguages.indexOf(language)

  return rank === -1 ? context.posterLanguages.length : rank
}

/**
 * Lists a film's poster images, those in the preferred languages first.
 */
export async function fetchTmdbPosterPaths(context: Context, movieId: number): Promise<string[]> {
  const { posters } = await fetchTmdb(
    context,
    buildTmdbImagesUrl(movieId),
    tmdbImagesResponseSchema,
  )

  return posters
    .toSorted(
      (a, b) =>
        toPosterLanguageRank(context, a.iso_639_1) - toPosterLanguageRank(context, b.iso_639_1),
    )
    .map((poster) => poster.file_path)
}

/**
 * Searches TMDB for people by name.
 * Results are ranked by relevance, so the caller must still settle which person is meant.
 */
export async function fetchTmdbPeople(context: Context, name: string): Promise<TmdbPerson[]> {
  const response = await fetchTmdb(
    context,
    buildTmdbPersonSearchUrl(context.tmdb, name),
    tmdbPersonSearchResponseSchema,
  )

  return response.results
}

// Matched exactly: "Assistant Director" and "Sound Director" are in the same crew list.
const DIRECTOR_JOB = 'Director'

/**
 * Lists the films a person directed.
 */
export async function fetchTmdbDirectorCredits(
  context: Context,
  personId: number,
): Promise<TmdbCrewCredit[]> {
  const response = await fetchTmdb(
    context,
    buildTmdbPersonCreditsUrl(context.tmdb, personId),
    tmdbMovieCreditsResponseSchema,
  )

  return response.crew.filter((credit) => credit.job === DIRECTOR_JOB)
}

const RELEASE_DATE_PATTERN = /^(\d{4})-\d{2}-\d{2}$/u

/**
 * Reads the year from a TMDB release date.
 * Null for an absent or empty date; a malformed one throws.
 */
export function toReleaseYear(releaseDate: string | undefined): number | null {
  if (!releaseDate) {
    return null
  }

  const match = RELEASE_DATE_PATTERN.exec(releaseDate)

  if (match === null) {
    throw new FilmLookupError(`Not a TMDB release date: ${releaseDate}`, 'tmdb', { releaseDate })
  }

  return Number(match[1])
}

const ENGLISH = 'en'

/**
 * Picks a film's English title, or its original title if TMDB has none.
 * TMDB blanks a translated title equal to the original and may list one English entry per
 * country, so the first non-blank one wins.
 */
export function toEnglishTitle(movie: TmdbMovie): string {
  const english = movie.translations.translations
    .filter((translation) => translation.iso_639_1 === ENGLISH)
    .map((translation) => translation.data.title)

  return english.find(isNonEmpty) ?? movie.original_title
}

/**
 * Converts a TMDB film into a Film, leaving the Wikidata ids for linkFilms to fill.
 */
export function toFilm(movie: TmdbMovie): Film {
  return {
    tmdbId: movie.id,
    imdbId: movie.imdb_id,
    // linkFilms fills these from Wikidata.
    wikidataId: null,
    catalogueIds: {},
    title: movie.title,
    englishTitle: toEnglishTitle(movie),
    originalTitle: movie.original_title,
    releaseYear: toReleaseYear(movie.release_date),
    runtimeMinutes: movie.runtime,
    posterPath: movie.poster_path,
    directors: toDirectors(movie),
    genreIds: movie.genres.map((genre) => genre.id),
  }
}

/**
 * Lists the names of a film's directors.
 */
export function toDirectors(movie: TmdbMovie): string[] {
  return movie.credits.crew
    .filter((member) => member.job === DIRECTOR_JOB)
    .map((member) => member.name)
}

// A synopsis names the top-billed cast, not the extras.
const BILLING_LIMIT = 10

/**
 * Lists a film's top-billed actors, in billing order.
 */
export function toCast(movie: TmdbMovie): string[] {
  return movie.credits.cast
    .toSorted((a, b) => a.order - b.order)
    .slice(0, BILLING_LIMIT)
    .map((member) => member.name)
}

/**
 * Gathers every title a film is known by, in any language, without duplicates.
 */
export function toKnownTitles(movie: TmdbMovie): string[] {
  const titles = [
    movie.title,
    movie.original_title,
    ...movie.translations.translations.map((translation) => translation.data.title),
    ...movie.alternative_titles.titles.map((alternativeTitle) => alternativeTitle.title),
  ]

  return unique(titles.filter(isNonEmpty))
}

/**
 * Fetches several films' full details from TMDB, one request at a time as TMDB asks.
 */
export async function fetchTmdbMovies(context: Context, movieIds: number[]): Promise<TmdbMovie[]> {
  return Array.fromAsync(movieIds, (movieId) => fetchTmdbMovie(context, movieId))
}
