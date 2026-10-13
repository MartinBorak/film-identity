import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { buildContext, toRequestHeaders } from '../__fixtures__/fakeCatalogues.js'
import { FilmLookupError } from './errors.js'
import {
  buildTmdbMovieUrl,
  buildTmdbPersonCreditsUrl,
  buildTmdbPersonSearchUrl,
  buildTmdbSearchUrl,
  fetchTmdb,
  fetchTmdbDirectorCredits,
  fetchTmdbMovie,
  fetchTmdbPeople,
  fetchTmdbPosterPaths,
  fetchTmdbSearchResults,
  toCast,
  toDirectors,
  toEnglishTitle,
  toFilm,
  toKnownTitles,
  toReleaseYear,
  type TmdbMovie,
} from './tmdb.js'

// Real TMDB responses, saved by hand.
const fixtureDirectory = dirname(fileURLToPath(import.meta.url))

function readFixture(name: string): string {
  return readFileSync(join(fixtureDirectory, `../__fixtures__/${name}`), 'utf-8')
}

const searchFixture = readFixture('tmdb-search.json')
const movieFixture = readFixture('tmdb-movie.json')
const movieWithoutPosterFixture = readFixture('tmdb-movie-without-poster.json')
const personSearchFixture = readFixture('tmdb-person-search.json')
const personCreditsFixture = readFixture('tmdb-person-credits.json')

const context = buildContext()

function stubTmdbResponse(body: string) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildTmdbSearchUrl', () => {
  it('searches the movie endpoint for the given title', () => {
    const url = new URL(buildTmdbSearchUrl(context.tmdb, 'Odysea'))

    expect(url.origin + url.pathname).toBe('https://api.themoviedb.org/3/search/movie')
    expect(url.searchParams.get('query')).toBe('Odysea')
  })

  it('asks for results in the configured language and region', () => {
    const url = new URL(buildTmdbSearchUrl(context.tmdb, 'Odysea'))

    expect(url.searchParams.get('language')).toBe('sk-SK')
    expect(url.searchParams.get('region')).toBe('SK')
  })

  it('leaves the region out where none is configured', () => {
    const url = new URL(
      buildTmdbSearchUrl(
        buildContext({ tmdb: { readAccessToken: 't', language: 'de-DE' } }).tmdb,
        'x',
      ),
    )

    expect(url.searchParams.has('region')).toBe(false)
  })

  it('encodes a title that is not URL-safe', () => {
    const url = new URL(buildTmdbSearchUrl(context.tmdb, 'Tajomstvo krištáľovej planéty'))

    expect(url.searchParams.get('query')).toBe('Tajomstvo krištáľovej planéty')
    expect(url.toString()).not.toContain(' ')
  })
})

describe('buildTmdbMovieUrl', () => {
  it('addresses one film, in the configured language', () => {
    const url = new URL(buildTmdbMovieUrl(context.tmdb, 1288445))

    expect(url.origin + url.pathname).toBe('https://api.themoviedb.org/3/movie/1288445')
    expect(url.searchParams.get('language')).toBe('sk-SK')
  })

  it('appends the title sets and the credits rather than fetching them separately', () => {
    const url = new URL(buildTmdbMovieUrl(context.tmdb, 1288445))

    expect(url.searchParams.get('append_to_response')).toBe(
      'translations,alternative_titles,credits',
    )
  })
})

describe('buildTmdbPersonSearchUrl', () => {
  it('searches the person endpoint for the given name', () => {
    const url = new URL(buildTmdbPersonSearchUrl(context.tmdb, 'Edmunds Jansons'))

    expect(url.origin + url.pathname).toBe('https://api.themoviedb.org/3/search/person')
    expect(url.searchParams.get('query')).toBe('Edmunds Jansons')
  })
})

describe('buildTmdbPersonCreditsUrl', () => {
  it('addresses one person’s film credits', () => {
    const url = new URL(buildTmdbPersonCreditsUrl(context.tmdb, 1198981))

    expect(url.origin + url.pathname).toBe(
      'https://api.themoviedb.org/3/person/1198981/movie_credits',
    )
  })
})

describe('toDirectors', () => {
  it('takes the directors out of the whole crew', () => {
    expect(toDirectors(JSON.parse(movieFixture) as TmdbMovie)).toEqual(['Jean-François Richet'])
  })

  it('finds no director on a film TMDB credits none', () => {
    const uncredited = {
      ...(JSON.parse(movieFixture) as TmdbMovie),
      credits: { crew: [], cast: [] },
    }

    expect(toDirectors(uncredited)).toEqual([])
  })

  it('takes the top of the billing in order', () => {
    const movie = {
      ...(JSON.parse(movieFixture) as TmdbMovie),
      credits: {
        crew: [],
        cast: [
          { name: 'Third', order: 2 },
          { name: 'First', order: 0 },
          { name: 'Second', order: 1 },
        ],
      },
    }

    expect(toCast(movie)).toEqual(['First', 'Second', 'Third'])
  })
})

describe('fetchTmdb', () => {
  it('fails loudly, without fetching, when the token is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const unconfigured = buildContext({ tmdb: { readAccessToken: '', language: 'sk-SK' } })

    await expect(
      fetchTmdb(unconfigured, 'https://api.themoviedb.org/3/movie/1', z.unknown()),
    ).rejects.toThrow(FilmLookupError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends the token and the configured user agent', async () => {
    const fetchSpy = stubTmdbResponse(searchFixture)

    await fetchTmdbSearchResults(buildContext({ userAgent: 'MyBot/1.0' }), 'Vzbura')

    const headers = toRequestHeaders(...fetchSpy.mock.calls[0])

    expect(headers.get('authorization')).toBe('Bearer test-token')
    expect(headers.get('user-agent')).toBe('MyBot/1.0')
  })
})

describe('fetchTmdbSearchResults', () => {
  it('reads a real search response', async () => {
    stubTmdbResponse(searchFixture)

    const results = await fetchTmdbSearchResults(context, 'Vzbura')

    expect(results).toHaveLength(9)
    expect(results[1]).toMatchObject({
      id: 1288445,
      title: 'Vzbura',
      original_title: 'Mutiny',
      release_date: '2026-08-19',
    })
  })

  // The fixture's top hit is a 1978 documentary, not the film being screened.
  it('does not rank the screening film first', async () => {
    stubTmdbResponse(searchFixture)

    const results = await fetchTmdbSearchResults(context, 'Vzbura')

    expect(results[0].title).toBe('Príbelská vzbura Janka Kráľa')
  })
})

describe('fetchTmdbMovie', () => {
  it('reads a real film response', async () => {
    stubTmdbResponse(movieFixture)

    const movie = await fetchTmdbMovie(context, 1288445)

    expect(movie).toMatchObject({
      id: 1288445,
      title: 'Vzbura',
      original_title: 'Mutiny',
      imdb_id: 'tt32338669',
      runtime: 95,
    })
  })

  it('accepts a film TMDB holds no poster for', async () => {
    stubTmdbResponse(movieWithoutPosterFixture)

    const movie = await fetchTmdbMovie(context, 1216353)

    expect(movie.poster_path).toBeNull()
    expect(movie.title).toBe('Príbelská vzbura Janka Kráľa')
  })
})

describe('fetchTmdbPosterPaths', () => {
  // The test context prefers sk, cs, en, then no language; unlisted languages come last.
  it('orders the posters by the configured language preference', async () => {
    stubTmdbResponse(
      JSON.stringify({
        posters: [
          { file_path: '/none.jpg', iso_639_1: null },
          { file_path: '/de.jpg', iso_639_1: 'de' },
          { file_path: '/en.jpg', iso_639_1: 'en' },
          { file_path: '/sk.jpg', iso_639_1: 'sk' },
        ],
      }),
    )

    expect(await fetchTmdbPosterPaths(context, 1)).toEqual([
      '/sk.jpg',
      '/en.jpg',
      '/none.jpg',
      '/de.jpg',
    ])
  })
})

describe('fetchTmdbPeople', () => {
  it('reads a real person search response', async () => {
    stubTmdbResponse(personSearchFixture)

    const people = await fetchTmdbPeople(context, 'Edmunds Jansons')

    expect(people).toEqual([{ id: 1198981, name: 'Edmunds Jansons' }])
  })
})

describe('fetchTmdbDirectorCredits', () => {
  it('finds the film a person directed among their credits in every department', async () => {
    stubTmdbResponse(personCreditsFixture)

    const credits = await fetchTmdbDirectorCredits(context, 1198981)

    expect(credits).toContainEqual({ id: 947474, job: 'Director', release_date: '2026-08-20' })
  })

  it('keeps only the job that means it', async () => {
    stubTmdbResponse(personCreditsFixture)

    const credits = await fetchTmdbDirectorCredits(context, 1198981)

    expect(credits.map((credit) => credit.job)).toEqual(credits.map(() => 'Director'))
    expect(credits.length).toBeLessThan(
      (JSON.parse(personCreditsFixture) as { crew: unknown[] }).crew.length,
    )
  })

  it('accepts a credit TMDB gives no release date', async () => {
    stubTmdbResponse(personCreditsFixture)

    const credits = await fetchTmdbDirectorCredits(context, 1198981)

    expect(credits).toContainEqual({ id: 645232, job: 'Director' })
  })
})

describe('toReleaseYear', () => {
  it('reads the year out of a TMDB release date', () => {
    expect(toReleaseYear('2026-08-19')).toBe(2026)
  })

  it('reports no year for a film TMDB gives no date', () => {
    expect(toReleaseYear(undefined)).toBeNull()
    expect(toReleaseYear('')).toBeNull()
  })

  it('throws on a date it cannot read', () => {
    expect(() => toReleaseYear('19 August 2026')).toThrow(FilmLookupError)
  })
})

describe('toEnglishTitle', () => {
  it('reads a blank English translation as the original title', async () => {
    stubTmdbResponse(movieFixture)

    expect(toEnglishTitle(await fetchTmdbMovie(context, 1288445))).toBe('Mutiny')
  })

  it('calls an untranslated film what it is called at home', async () => {
    stubTmdbResponse(movieWithoutPosterFixture)

    expect(toEnglishTitle(await fetchTmdbMovie(context, 1216353))).toBe(
      'Príbelská vzbura Janka Kráľa',
    )
  })

  it('takes the first English entry that says anything', async () => {
    stubTmdbResponse(movieFixture)
    const movie = await fetchTmdbMovie(context, 1288445)

    const inTwoCountries = {
      ...movie,
      translations: {
        translations: [
          { iso_639_1: 'en', data: { title: '' } },
          { iso_639_1: 'en', data: { title: 'The Mutiny' } },
        ],
      },
    }

    expect(toEnglishTitle(inTwoCountries)).toBe('The Mutiny')
  })

  it('ignores the translations that are not English', async () => {
    stubTmdbResponse(movieFixture)
    const movie = await fetchTmdbMovie(context, 1288445)

    const czechOnly = {
      ...movie,
      translations: { translations: [{ iso_639_1: 'cs', data: { title: 'Vzpoura' } }] },
    }

    expect(toEnglishTitle(czechOnly)).toBe('Mutiny')
  })
})

describe('toFilm', () => {
  it('takes the local title from the response and the English one from the translations', async () => {
    stubTmdbResponse(movieFixture)

    expect(toFilm(await fetchTmdbMovie(context, 1288445))).toMatchObject({
      title: 'Vzbura',
      englishTitle: 'Mutiny',
      originalTitle: 'Mutiny',
      wikidataId: null,
      catalogueIds: {},
    })
  })
})

describe('toKnownTitles', () => {
  it('finds the cross-language title that only the translations carry', async () => {
    stubTmdbResponse(movieFixture)

    const knownTitles = toKnownTitles(await fetchTmdbMovie(context, 1288445))

    expect(knownTitles).toContain('Vzpoura')
    expect(knownTitles).toContain('Código: Venganza')
  })

  it('drops the blank titles TMDB pads its translations with', async () => {
    stubTmdbResponse(movieFixture)

    expect(toKnownTitles(await fetchTmdbMovie(context, 1288445))).not.toContain('')
  })
})
