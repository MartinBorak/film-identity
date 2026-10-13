import { vi } from 'vitest'
import { z } from 'zod'

import { resolveConfig, type Context, type FilmIdentityConfig } from '../config.js'
import type { Listing } from '../types.js'

export function buildContext(config: Partial<FilmIdentityConfig> = {}): Context {
  return resolveConfig({
    tmdb: { readAccessToken: 'test-token', language: 'sk-SK', region: 'SK' },
    wikidata: { languages: ['sk', 'cs', 'en'], idProperties: ['P2529'] },
    userAgent: 'film-identity-tests',
    ...config,
  })
}

export const FAKE_MODEL_HOST = 'model.test'

/*
 * Goes through fetch like a real model client, so stubCatalogues answers it and tests can count it.
 */
async function askFakeModel(systemPrompt: string, message: string): Promise<string> {
  const response = await fetch(`https://${FAKE_MODEL_HOST}/`, {
    method: 'POST',
    body: JSON.stringify({ systemPrompt, message }),
  })

  if (!response.ok) {
    throw new Error(`The fake model failed with ${response.status}`)
  }

  return response.text()
}

export function withModel(config: Partial<FilmIdentityConfig> = {}): Context {
  return buildContext({
    model: { ask: askFakeModel, listingLanguage: 'Slovak', relatedLanguages: ['Czech'] },
    ...config,
  })
}

export function screenedIn(
  title: string,
  screeningYear: number,
  listing: Partial<Listing> = {},
): Listing {
  return { titles: [title], screeningYear, ...listing }
}

export type FakeMovie = {
  id: number
  title: string
  originalTitle?: string
  releaseDate?: string
  translations?: string[]
  // Separate from translations because a film is displayed under its English title.
  englishTitle?: string
  directors?: string[]
  cast?: string[]
  genres?: { id: number; name: string }[]
}

export type FakePerson = {
  id: number
  name: string
  directed: FakeMovie[]
}

function toSearchBody(movies: FakeMovie[]): string {
  return JSON.stringify({
    results: movies.map((movie) => ({
      id: movie.id,
      title: movie.title,
      original_title: movie.originalTitle ?? movie.title,
      release_date: movie.releaseDate ?? '2026-01-01',
    })),
  })
}

function toMovieBody(movie: FakeMovie): string {
  return JSON.stringify({
    id: movie.id,
    title: movie.title,
    original_title: movie.originalTitle ?? movie.title,
    release_date: movie.releaseDate ?? '2026-01-01',
    imdb_id: `tt${movie.id}`,
    runtime: 100,
    poster_path: '/poster.jpg',
    translations: {
      translations: [
        ...(movie.translations ?? []).map((title) => ({ iso_639_1: 'cs', data: { title } })),
        // TMDB always lists English, blank where the title is the original.
        { iso_639_1: 'en', data: { title: movie.englishTitle ?? '' } },
      ],
    },
    alternative_titles: { titles: [] },
    credits: {
      crew: (movie.directors ?? []).map((name) => ({ job: 'Director', name })),
      cast: (movie.cast ?? []).map((name, order) => ({ name, order })),
    },
    genres: movie.genres ?? [],
  })
}

function toCreditsBody(person: FakePerson): string {
  return JSON.stringify({
    id: person.id,
    cast: [],
    // TMDB omits the date, rather than emptying it, where a film has none.
    crew: person.directed.map((movie) => ({
      id: movie.id,
      job: 'Director',
      release_date: movie.releaseDate,
    })),
  })
}

/*
 * An empty title means Wikidata has no such item.
 */
function toEntitiesBody(wikidataId: string, title: string): string {
  const entity = {
    labels: { sk: { value: title } },
    claims: {
      P577: [
        { rank: 'normal', mainsnak: { datavalue: { value: { time: '+1986-01-01T00:00:00Z' } } } },
      ],
    },
  }

  return JSON.stringify({ entities: title === '' ? {} : { [wikidataId]: entity } })
}

/*
 * The model answers every listing with the same proposed queries.
 */
export type FakePosterRoute = {
  proposedQueries?: string[]
  // Absent, the model picks none.
  selectedTmdbId?: number | null
  // The HTTP status every model request fails with.
  modelFailsWith?: number
  posterPathsByMovieId?: Record<number, string[]>
  imageBytesByUrl?: Record<string, Uint8Array>
}

const modelRequestSchema = z.object({ systemPrompt: z.string(), message: z.string() })

/*
 * Only the selection request shows the model candidates.
 */
function isSelectionRequest(init: RequestInit | undefined): boolean {
  const request = modelRequestSchema.parse(JSON.parse(String(init?.body)))

  return request.message.includes('"candidates"')
}

/*
 * Results are given per query so a test can fix TMDB's ranking, which the resolver must distrust.
 */
function toResponse(
  url: URL,
  init: RequestInit | undefined,
  resultsByQuery: Record<string, FakeMovie[]>,
  peopleByQuery: Record<string, FakePerson[]>,
  wikidataTitleById: Record<string, string>,
  posterRoute: FakePosterRoute,
): Response {
  const query = url.searchParams.get('query') ?? ''

  if (url.hostname === 'www.wikidata.org') {
    const wikidataId = url.searchParams.get('ids') ?? ''

    return new Response(toEntitiesBody(wikidataId, wikidataTitleById[wikidataId] ?? ''))
  }

  if (url.hostname === FAKE_MODEL_HOST) {
    if (posterRoute.modelFailsWith !== undefined) {
      return new Response('', { status: posterRoute.modelFailsWith })
    }

    return new Response(
      JSON.stringify(
        isSelectionRequest(init)
          ? { tmdbId: posterRoute.selectedTmdbId ?? null }
          : (posterRoute.proposedQueries ?? []),
      ),
    )
  }

  const image = posterRoute.imageBytesByUrl?.[url.toString()]

  if (image !== undefined) {
    return new Response(new Uint8Array(image), { headers: { 'content-type': 'image/jpeg' } })
  }

  const imagesMatch = /^\/3\/movie\/(\d+)\/images$/u.exec(url.pathname)

  if (imagesMatch) {
    const paths = posterRoute.posterPathsByMovieId?.[Number(imagesMatch[1])] ?? []

    return new Response(
      JSON.stringify({ posters: paths.map((path) => ({ file_path: path, iso_639_1: 'en' })) }),
    )
  }

  if (url.pathname === '/3/search/movie') {
    return new Response(toSearchBody(resultsByQuery[query] ?? []))
  }

  if (url.pathname === '/3/search/person') {
    const people = peopleByQuery[query] ?? []

    return new Response(JSON.stringify({ results: people.map(({ id, name }) => ({ id, name })) }))
  }

  const people = Object.values(peopleByQuery).flat()
  const person = people.find(({ id }) => url.pathname === `/3/person/${id}/movie_credits`)

  if (person) {
    return new Response(toCreditsBody(person))
  }

  const movie = [
    ...Object.values(resultsByQuery).flat(),
    ...people.flatMap(({ directed }) => directed),
  ].find(({ id }) => url.pathname === `/3/movie/${id}`)

  return movie ? new Response(toMovieBody(movie)) : new Response('', { status: 404 })
}

/**
 * Reads the address a fetch call asked for, whether it was given a Request or a plain address.
 */
export function toRequestUrl(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : String(input))
}

/**
 * Reads the headers a fetch call sent, whether they were on a Request or in the options.
 */
export function toRequestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  return new Headers(input instanceof Request ? input.headers : init?.headers)
}

export function stubCatalogues(
  resultsByQuery: Record<string, FakeMovie[]>,
  peopleByQuery: Record<string, FakePerson[]> = {},
  wikidataTitleById: Record<string, string> = {},
  posterRoute: FakePosterRoute = {},
) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input, init) =>
      Promise.resolve(
        toResponse(
          toRequestUrl(input),
          init,
          resultsByQuery,
          peopleByQuery,
          wikidataTitleById,
          posterRoute,
        ),
      ),
    )
}

export function toRequestedHosts(fetchSpy: ReturnType<typeof stubCatalogues>): string[] {
  return fetchSpy.mock.calls.map(([input]) => toRequestUrl(input).hostname)
}

export function toRequestedPaths(fetchSpy: ReturnType<typeof stubCatalogues>): string[] {
  return fetchSpy.mock.calls.map(([input]) => toRequestUrl(input).pathname)
}
