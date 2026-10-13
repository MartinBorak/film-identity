import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildContext,
  screenedIn,
  stubCatalogues,
  toRequestedPaths,
} from '../__fixtures__/fakeCatalogues.js'
import { identifyFilm, identifyFilms } from './identify.js'

const context = buildContext()

afterEach(() => {
  vi.restoreAllMocks()
})

describe('identifyFilm', () => {
  it('resolves a title to the film TMDB knows by that name', async () => {
    stubCatalogues({ Odysea: [{ id: 42, title: 'Odysea', originalTitle: 'The Odyssey' }] })

    expect(await identifyFilm(context, screenedIn('Odysea', 2026))).toEqual({
      evidence: 'title',
      film: {
        tmdbId: 42,
        imdbId: 'tt42',
        // TMDB holds neither; linkFilms adds them from Wikidata.
        wikidataId: null,
        catalogueIds: {},
        title: 'Odysea',
        // No English translation on TMDB, so the original title stands in.
        englishTitle: 'The Odyssey',
        originalTitle: 'The Odyssey',
        releaseYear: 2026,
        runtimeMinutes: 100,
        posterPath: '/poster.jpg',
        directors: [],
        genreIds: [],
      },
    })
  })

  it('carries both languages of a title into the film it resolves to', async () => {
    stubCatalogues({
      'Návrat do budúcnosti': [
        {
          id: 105,
          title: 'Návrat do budúcnosti',
          originalTitle: 'Back to the Future',
          englishTitle: 'Back to the Future Part I',
        },
      ],
    })

    const match = await identifyFilm(context, screenedIn('Návrat do budúcnosti', 2026))

    expect(match.film).toMatchObject({
      title: 'Návrat do budúcnosti',
      englishTitle: 'Back to the Future Part I',
    })
  })

  // "Vzpoura" is two edits from "Vzbura", beyond the distance rule; only translations reach it.
  it('resolves a title in a neighbouring language through the full title set', async () => {
    stubCatalogues({
      Vzpoura: [
        { id: 1, title: 'Príbelská vzbura Janka Kráľa', releaseDate: '1978-01-01' },
        { id: 2, title: 'Vzbura', originalTitle: 'Mutiny', translations: ['Vzpoura'] },
      ],
    })

    expect(await identifyFilm(context, screenedIn('Vzpoura', 2026))).toMatchObject({
      evidence: 'title',
      film: { tmdbId: 2 },
    })
  })

  it('resolves a title two films share, in a year they also share, on the director', async () => {
    stubCatalogues({
      Aftersun: [
        { id: 969829, title: 'Aftersun', releaseDate: '2022-05-01', directors: ['Lluís Galter'] },
        {
          id: 965150,
          title: 'Aftersun',
          releaseDate: '2022-10-21',
          directors: ['Charlotte Wells'],
        },
      ],
    })

    const match = await identifyFilm(
      context,
      screenedIn('Aftersun', 2026, { productionYears: [2022], directors: ['Charlotte Wells'] }),
    )

    expect(match).toMatchObject({ evidence: 'title', film: { tmdbId: 965150 } })
  })

  it('resolves a title several films share on the people the cinema’s blurb names', async () => {
    stubCatalogues({
      Digger: [
        { id: 656272, title: 'Digger', releaseDate: '2021-06-17', cast: ['Vangelis Mourikis'] },
        { id: 1248832, title: 'Digger', releaseDate: '2026-09-30', cast: ['Tom Cruise'] },
      ],
    })

    const match = await identifyFilm(
      context,
      screenedIn('Digger', 2026, {
        synopses: ['V novej čiernej komédii sa Tom Cruise predstaví ako magnát Digger Rockwell.'],
      }),
    )

    expect(match).toMatchObject({ evidence: 'title', film: { tmdbId: 1248832 } })
  })

  // "Dog Stars" is too far from "The Dog Stars" for a title match; the director corroborates it.
  it('resolves a title only the cinema’s original title and director reach', async () => {
    stubCatalogues({
      'Dog Stars': [{ id: 1384216, title: 'The Dog Stars', directors: ['Ridley Scott'] }],
    })

    const match = await identifyFilm(
      context,
      screenedIn('Psie hviezdy', 2026, {
        originalTitles: ['Dog Stars'],
        directors: ['Ridley Scott'],
      }),
    )

    expect(match).toMatchObject({ evidence: 'title', film: { tmdbId: 1384216 } })
  })

  it('does not admit a film a split candidate found, however well corroborated', async () => {
    stubCatalogues({
      'Psie hviezdy': [{ id: 1384216, title: 'The Dog Stars', directors: ['Ridley Scott'] }],
    })

    const match = await identifyFilm(
      context,
      screenedIn('Psie hviezdy', 2026, { directors: ['Ridley Scott'] }),
    )

    expect(match).toEqual({ evidence: 'unmatched', film: null })
  })

  it('does not ask about a director when the title already settled the film', async () => {
    const fetchSpy = stubCatalogues(
      { Odysea: [{ id: 42, title: 'Odysea' }] },
      { 'Christopher Nolan': [{ id: 525, name: 'Christopher Nolan', directed: [] }] },
    )

    await identifyFilm(
      context,
      screenedIn('Odysea', 2026, { productionYears: [2026], directors: ['Christopher Nolan'] }),
    )

    expect(toRequestedPaths(fetchSpy)).toEqual(['/3/search/movie', '/3/movie/42'])
  })

  // TMDB knows the film only as the Latvian "Laimīgie", so the Slovak title finds nothing.
  it('resolves a title only the cinema’s director reaches', async () => {
    stubCatalogues(
      {},
      {
        'Edmunds Jansons': [
          {
            id: 1198981,
            name: 'Edmunds Jansons',
            directed: [
              { id: 580256, title: 'Jēkabs, Mimmi un runājošie suņi', releaseDate: '2019-02-01' },
              { id: 947474, title: 'Laimīgie', releaseDate: '2026-08-20' },
            ],
          },
        ],
      },
    )

    const match = await identifyFilm(
      context,
      screenedIn('Tajomstvo džungle', 2026, {
        productionYears: [2026],
        directors: ['Edmunds Jansons'],
      }),
    )

    expect(match).toMatchObject({ evidence: 'director', film: { tmdbId: 947474 } })
  })

  it('pools the films of two people sharing a director’s name', async () => {
    stubCatalogues(
      {},
      {
        'Edmunds Jansons': [
          {
            id: 1198981,
            name: 'Edmunds Jansons',
            directed: [{ id: 947474, title: 'Laimīgie', releaseDate: '2026-08-20' }],
          },
          { id: 2098866, name: 'Edmunds Jansons', directed: [] },
        ],
      },
    )

    const match = await identifyFilm(
      context,
      screenedIn('Tajomstvo džungle', 2026, {
        productionYears: [2026],
        directors: ['Edmunds Jansons'],
      }),
    )

    expect(match).toMatchObject({ film: { tmdbId: 947474 } })
  })

  it('refuses when each of two namesakes made a film that year', async () => {
    stubCatalogues(
      {},
      {
        'Edmunds Jansons': [
          {
            id: 1198981,
            name: 'Edmunds Jansons',
            directed: [{ id: 947474, title: 'Laimīgie', releaseDate: '2026-08-20' }],
          },
          {
            id: 2098866,
            name: 'Edmunds Jansons',
            directed: [{ id: 1, title: 'Another Film', releaseDate: '2026-01-10' }],
          },
        ],
      },
    )

    const match = await identifyFilm(
      context,
      screenedIn('Tajomstvo džungle', 2026, {
        productionYears: [2026],
        directors: ['Edmunds Jansons'],
      }),
    )

    expect(match).toEqual({ evidence: 'unmatched', film: null })
  })

  it('refuses a director who made two films in the stated year', async () => {
    stubCatalogues(
      {},
      {
        'Edmunds Jansons': [
          {
            id: 1198981,
            name: 'Edmunds Jansons',
            directed: [
              { id: 947474, title: 'Laimīgie', releaseDate: '2026-08-20' },
              { id: 1329178, title: 'Brīvais nobrauciens', releaseDate: '2026-02-07' },
            ],
          },
        ],
      },
    )

    const match = await identifyFilm(
      context,
      screenedIn('Tajomstvo džungle', 2026, {
        productionYears: [2026],
        directors: ['Edmunds Jansons'],
      }),
    )

    expect(match).toEqual({ evidence: 'unmatched', film: null })
  })

  // Otherwise a retrospective would resolve to whatever its director released this year.
  it('does not ask about a director when the cinema printed no year', async () => {
    const fetchSpy = stubCatalogues(
      {},
      {
        'Edmunds Jansons': [
          {
            id: 1198981,
            name: 'Edmunds Jansons',
            directed: [{ id: 947474, title: 'Laimīgie', releaseDate: '2026-08-20' }],
          },
        ],
      },
    )

    const match = await identifyFilm(
      context,
      screenedIn('Tajomstvo džungle', 2026, { directors: ['Edmunds Jansons'] }),
    )

    expect(match).toEqual({ evidence: 'unmatched', film: null })
    expect(toRequestedPaths(fetchSpy)).not.toContain('/3/search/person')
  })

  it('leaves a title nothing settles unmatched', async () => {
    stubCatalogues({})

    expect(await identifyFilm(context, screenedIn('SNP v krátkych filmoch', 2026))).toEqual({
      evidence: 'unmatched',
      film: null,
    })
  })
})

describe('identifyFilms', () => {
  it('resolves a group of spellings from one search', async () => {
    const fetchSpy = stubCatalogues({
      'Harry Potter a Kameň mudrcov': [{ id: 671, title: 'Harry Potter a Kameň mudrcov' }],
    })

    const films = await identifyFilms(context, [
      screenedIn('Harry Potter a Kameň mudrcov', 2026),
      screenedIn('Klenoty žánrového filmu: HARRY POTTER A KAMEŇ MUDRCOV', 2026),
    ])

    expect(films.get('Klenoty žánrového filmu: HARRY POTTER A KAMEŇ MUDRCOV')?.film?.tmdbId).toBe(
      671,
    )
    expect(toRequestedPaths(fetchSpy)).toEqual(['/3/search/movie', '/3/movie/671'])
  })

  it('pools what a group’s listings said before asking', async () => {
    stubCatalogues({
      Aftersun: [
        { id: 969829, title: 'Aftersun', releaseDate: '2022-05-01', directors: ['Lluís Galter'] },
        {
          id: 965150,
          title: 'Aftersun',
          releaseDate: '2022-10-21',
          directors: ['Charlotte Wells'],
        },
      ],
    })

    const films = await identifyFilms(context, [
      screenedIn('Aftersun', 2026, { productionYears: [2022] }),
      screenedIn('AFTERSUN', 2026, { directors: ['Charlotte Wells'] }),
    ])

    expect(films.get('Aftersun')).toMatchObject({ film: { tmdbId: 965150 } })
    expect(films.get('AFTERSUN')).toMatchObject({ film: { tmdbId: 965150 } })
  })

  it('keeps unrelated listings apart', async () => {
    stubCatalogues({
      Odysea: [{ id: 1, title: 'Odysea' }],
      Bardotky: [{ id: 2, title: 'Bardotky' }],
    })

    const films = await identifyFilms(context, [
      screenedIn('Odysea', 2026),
      screenedIn('Bardotky', 2026),
    ])

    expect(films.get('Odysea')).toMatchObject({ film: { tmdbId: 1 } })
    expect(films.get('Bardotky')).toMatchObject({ film: { tmdbId: 2 } })
  })
})
