import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildContext, toRequestUrl } from '../__fixtures__/fakeCatalogues.js'
import { FilmLookupError } from './errors.js'
import {
  buildWikidataEntitiesUrl,
  buildWikidataFilmIdsByImdbIdUrl,
  buildWikidataFilmIdsUrl,
  buildWikidataFilmUrl,
  fetchWikidataFilm,
  fetchWikidataLinksByTmdbId,
  toWikidataFilm,
  toWikidataLinksByKey,
  type Entity,
} from './wikidata.js'

// Real Action API responses, fetched from URLs these builders produce.
const fixtureDirectory = dirname(fileURLToPath(import.meta.url))

function readFixture(name: string): string {
  return readFileSync(join(fixtureDirectory, `../__fixtures__/${name}`), 'utf-8')
}

const filmFixture = readFixture('wikidata-film.json')
const filmIdsSearchFixture = readFixture('wikidata-film-ids-search.json')
const filmIdsEntitiesFixture = readFixture('wikidata-film-ids-entities.json')

const context = buildContext()

/*
 * A fresh Response per call, since a body reads only once and a batched lookup fetches repeatedly.
 */
function stubWikidataResponse(body: string, entitiesBody: string = body) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const action = toRequestUrl(input).searchParams.get('action')

    return Promise.resolve(new Response(action === 'wbgetentities' ? entitiesBody : body))
  })
}

const NO_HITS = JSON.stringify({ query: { search: [] } })

function entity(
  claims: Record<string, unknown[]>,
  labels: Record<string, string> = {},
  rank: string = 'normal',
): Entity {
  return {
    claims: Object.fromEntries(
      Object.entries(claims).map(([property, values]) => [
        property,
        values.map((value) => ({ rank, mainsnak: { datavalue: { value } } })),
      ]),
    ),
    labels: Object.fromEntries(
      Object.entries(labels).map(([language, value]) => [language, { value }]),
    ),
  } as Entity
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildWikidataFilmUrl', () => {
  it('asks the Action API about one item, in the configured languages', () => {
    const url = new URL(buildWikidataFilmUrl(context, 'Q17167680'))

    expect(url.origin + url.pathname).toBe('https://www.wikidata.org/w/api.php')
    expect(url.searchParams.get('action')).toBe('wbgetentities')
    expect(url.searchParams.get('ids')).toBe('Q17167680')
    expect(url.searchParams.get('languages')).toBe('sk|cs|en')
    expect(url.searchParams.get('format')).toBe('json')
  })

  // 'Q1|Q2' would name a second item in the joined ids list.
  it('refuses an id that is not an item id', () => {
    expect(() => buildWikidataFilmUrl(context, 'Q1|Q2')).toThrow(FilmLookupError)
    expect(() => buildWikidataFilmUrl(context, 'Šiesta veta')).toThrow(FilmLookupError)
  })
})

describe('fetchWikidataFilm', () => {
  // The fixture has a ČSFD id and no TMDB id.
  it('reads a real response into the film it describes', async () => {
    stubWikidataResponse(filmFixture)

    const film = await fetchWikidataFilm(context, 'Q17167680')

    expect(film).toEqual({
      tmdbId: null,
      imdbId: 'tt0176139',
      wikidataId: 'Q17167680',
      catalogueIds: { P2529: '105930' },
      title: 'Šiesta veta',
      // The fixture has no English label and no original title.
      englishTitle: 'Šiesta veta',
      originalTitle: '',
      releaseYear: 1986,
      runtimeMinutes: 91,
      posterPath: null,
      directors: [],
      genreIds: [],
    })
  })

  // Overriding `wikidata` drops the test context's P2529 from idProperties.
  it('carries out only the configured identifier properties', async () => {
    stubWikidataResponse(filmFixture)

    const film = await fetchWikidataFilm(
      buildContext({ wikidata: { languages: ['sk'] } }),
      'Q17167680',
    )

    expect(film.catalogueIds).toEqual({})
  })
})

describe('buildWikidataEntitiesUrl', () => {
  it('asks for several items at once, with their claims and labels', () => {
    const url = new URL(buildWikidataEntitiesUrl(['Q1', 'Q2']))

    expect(url.searchParams.get('ids')).toBe('Q1|Q2')
    expect(url.searchParams.get('props')).toBe('claims|labels')
  })
})

describe('toWikidataFilm', () => {
  it('takes the earliest year a film was published anywhere', () => {
    const item = entity(
      { P577: [{ time: '+1988-03-01T00:00:00Z' }, { time: '+1986-01-01T00:00:00Z' }] },
      { sk: 'Šiesta veta' },
    )

    expect(toWikidataFilm(context, 'Q17167680', item).releaseYear).toBe(1986)
  })

  it('falls back to the next configured label where there is no first-language one', () => {
    const item = entity({}, { en: 'The Sixth Sentence' })

    expect(toWikidataFilm(context, 'Q17167680', item).title).toBe('The Sixth Sentence')
  })

  // The test context orders its languages sk, cs, en.
  it('prefers the labels in the configured order', () => {
    const item = entity({}, { cs: 'Proč bychom se nezabili', en: 'Why Not Kill Us' })

    expect(toWikidataFilm(context, 'Q140513860', item).title).toBe('Proč bychom se nezabili')
  })

  it('reads each label into its own title', () => {
    const item = entity({}, { sk: 'Šiesta veta', en: 'The Sixth Sentence' })

    expect(toWikidataFilm(context, 'Q17167680', item)).toMatchObject({
      title: 'Šiesta veta',
      englishTitle: 'The Sixth Sentence',
    })
  })

  it('falls back to the original title where there is no English label', () => {
    const item = entity({ P1476: [{ text: 'Mutiny', language: 'en' }] }, { sk: 'Vzbura' })

    expect(toWikidataFilm(context, 'Q17167680', item).englishTitle).toBe('Mutiny')
  })

  it('reads a runtime only when it is stated in minutes', () => {
    const inSeconds = entity(
      { P2047: [{ amount: '+5460', unit: 'http://www.wikidata.org/entity/Q11574' }] },
      { sk: 'Šiesta veta' },
    )

    expect(toWikidataFilm(context, 'Q17167680', inSeconds).runtimeMinutes).toBeNull()
  })

  it('reads the best-ranked value and never a deprecated one', () => {
    const labels = { sk: 'Šiesta veta' }
    const deprecated = entity({ P345: ['tt0000001'] }, labels, 'deprecated')
    const ranked: Entity = {
      ...entity({ P345: ['tt0000001'] }, labels),
      claims: {
        P345: [
          ...entity({ P345: ['tt0000001'] }).claims.P345,
          ...entity({ P345: ['tt0176139'] }, {}, 'preferred').claims.P345,
        ],
      },
    }

    expect(toWikidataFilm(context, 'Q17167680', deprecated).imdbId).toBeNull()
    expect(toWikidataFilm(context, 'Q17167680', ranked).imdbId).toBe('tt0176139')
  })

  // A wrong id comes back as an item with no label.
  it('refuses an item Wikidata describes no film for', () => {
    expect(() => toWikidataFilm(context, 'Q17167680', entity({}))).toThrow(FilmLookupError)
    expect(() => toWikidataFilm(context, 'Q17167680', undefined)).toThrow(FilmLookupError)
  })
})

describe('buildWikidataFilmIdsUrl', () => {
  it('searches the statement index for a batch of TMDB ids, in JSON', () => {
    const url = new URL(buildWikidataFilmIdsUrl([14231, 1684016]))

    expect(url.origin + url.pathname).toBe('https://www.wikidata.org/w/api.php')
    expect(url.searchParams.get('list')).toBe('search')
    expect(url.searchParams.get('srsearch')).toBe('haswbstatement:P4947=14231|P4947=1684016')
    expect(url.searchParams.get('format')).toBe('json')
  })

  it('refuses an id that is not a TMDB id', () => {
    expect(() => buildWikidataFilmIdsUrl([14231, Number('1|P31=Q5')])).toThrow(FilmLookupError)
    expect(() => buildWikidataFilmIdsUrl([1.5])).toThrow(FilmLookupError)
  })
})

describe('buildWikidataFilmIdsByImdbIdUrl', () => {
  it('asks the same question keyed on IMDb ids', () => {
    const url = new URL(buildWikidataFilmIdsByImdbIdUrl(['tt0498203', 'tt23807030']))

    expect(url.searchParams.get('srsearch')).toBe('haswbstatement:P345=tt0498203|P345=tt23807030')
  })

  it('refuses an id that is not an IMDb id', () => {
    expect(() => buildWikidataFilmIdsByImdbIdUrl(['tt1|P31=Q5'])).toThrow(FilmLookupError)
    expect(() => buildWikidataFilmIdsByImdbIdUrl(['0498203'])).toThrow(FilmLookupError)
  })
})

describe('fetchWikidataLinksByTmdbId', () => {
  // The fixture holds a film with both ids, a concert film ČSFD lacks, and a film with no item.
  it('reads a real response into the links each film reached', async () => {
    stubWikidataResponse(filmIdsSearchFixture, filmIdsEntitiesFixture)

    const linksByTmdbId = await fetchWikidataLinksByTmdbId(context, [14231, 1684016, 1525441])

    expect(linksByTmdbId.get(14231)).toEqual({
      wikidataId: 'Q871180',
      imdbId: 'tt0498203',
      catalogueIds: { P2529: '227756' },
    })
    expect(linksByTmdbId.get(1684016)).toEqual({
      wikidataId: 'Q139581858',
      imdbId: 'tt38882652',
      catalogueIds: {},
    })
    expect(linksByTmdbId.has(1525441)).toBe(false)
  })

  it('splits a corpus larger than one batch across several searches', async () => {
    const fetchSpy = stubWikidataResponse(NO_HITS)

    await fetchWikidataLinksByTmdbId(
      context,
      Array.from({ length: 101 }, (_, index) => index + 1),
    )

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('asks nothing when no film needs a lookup', async () => {
    const fetchSpy = stubWikidataResponse('')

    expect(await fetchWikidataLinksByTmdbId(context, [])).toEqual(new Map())
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('toWikidataLinksByKey', () => {
  it('yields nothing for a TMDB id two items claim', () => {
    const entities = {
      Q871180: entity({ P4947: ['14231'] }),
      Q999999: entity({ P4947: ['14231'] }),
    }

    expect(toWikidataLinksByKey(context, 'P4947', ['14231'], entities)).toEqual(new Map())
  })

  it('keys only the ids that were asked about', () => {
    const entities = { Q871180: entity({ P4947: ['14231', '99'], P2529: ['227756'] }) }

    expect(toWikidataLinksByKey(context, 'P4947', ['14231'], entities)).toEqual(
      new Map([
        ['14231', { wikidataId: 'Q871180', imdbId: null, catalogueIds: { P2529: '227756' } }],
      ]),
    )
  })
})
