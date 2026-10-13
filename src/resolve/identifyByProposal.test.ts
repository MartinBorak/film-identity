import sharp from 'sharp'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  buildContext,
  FAKE_MODEL_HOST,
  screenedIn,
  stubCatalogues,
  toRequestedHosts,
  withModel,
  type FakePosterRoute,
  toRequestUrl,
} from '../__fixtures__/fakeCatalogues.js'
import { identifyFilm } from './identify.js'

/*
 * A gradient whose tilt tells artworks apart; sizes differ like a cinema's and TMDB's copies.
 */
async function artwork(width: number, height: number, tilt: number): Promise<Uint8Array> {
  const pixels = Buffer.from(
    [...Array(width * height).keys()].map((index) =>
      Math.round(
        (255 * ((index % width) + tilt * Math.floor(index / width))) / (width + tilt * height),
      ),
    ),
  )

  return new Uint8Array(
    await sharp(pixels, { raw: { width, height, channels: 1 } })
      .jpeg()
      .toBuffer(),
  )
}

const CINEMA_POSTER = 'https://www.cinemacity.sk/posters/8085S2R1.jpg'

/*
 * No TMDB title of this film matches the cinema's Slovak one.
 */
const BRAND_NEW_DAY = { id: 969681, title: 'Spider-Man: Brand New Day' }
const OTHER_FILM = { id: 4242, title: 'Some Other Film' }

const context = withModel()

let posterRoute: FakePosterRoute

beforeAll(async () => {
  posterRoute = {
    proposedQueries: ['Spider-Man: Brand New Day', 'Spider-Man 4'],
    posterPathsByMovieId: { [BRAND_NEW_DAY.id]: ['/spider.jpg'], [OTHER_FILM.id]: ['/other.jpg'] },
    imageBytesByUrl: {
      [CINEMA_POSTER]: await artwork(300, 450, 1),
      'https://image.tmdb.org/t/p/w342/spider.jpg': await artwork(200, 300, 1),
      'https://image.tmdb.org/t/p/w342/other.jpg': await artwork(200, 300, -1),
    },
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('identifyFilm by proposed query', () => {
  it('admits the film whose poster the cinema shows, among the films a proposed query finds', async () => {
    stubCatalogues(
      { 'Spider-Man: Brand New Day': [OTHER_FILM, BRAND_NEW_DAY], 'Spider-Man 4': [OTHER_FILM] },
      {},
      {},
      posterRoute,
    )

    const match = await identifyFilm(
      context,
      screenedIn('Spider-Man: Nový deň UKR', 2026, { posterUrls: [CINEMA_POSTER] }),
    )

    expect(match).toMatchObject({ evidence: 'poster', film: { tmdbId: BRAND_NEW_DAY.id } })
  })

  it('reports a poster admission through the configured log', async () => {
    const log = vi.fn()
    stubCatalogues(
      { 'Spider-Man: Brand New Day': [OTHER_FILM, BRAND_NEW_DAY] },
      {},
      {},
      posterRoute,
    )

    await identifyFilm(
      withModel({ log }),
      screenedIn('Spider-Man: Nový deň UKR', 2026, { posterUrls: [CINEMA_POSTER] }),
    )

    expect(log).toHaveBeenCalledWith(expect.stringContaining(`tmdb:${BRAND_NEW_DAY.id}`))
  })

  it('leaves a title unmatched when no candidate shares its poster', async () => {
    stubCatalogues(
      { 'Spider-Man: Brand New Day': [OTHER_FILM], 'Spider-Man 4': [OTHER_FILM] },
      {},
      {},
      posterRoute,
    )

    const match = await identifyFilm(
      context,
      screenedIn('Spider-Man: Nový deň UKR', 2026, { posterUrls: [CINEMA_POSTER] }),
    )

    expect(match).toEqual({ evidence: 'unmatched', film: null })
  })

  // A re-release shares its original's artwork.
  it('refuses when two candidates share the poster', async () => {
    const twin = { id: 5151, title: 'Spider-Man: Brand New Day (Re-release)' }
    stubCatalogues(
      { 'Spider-Man: Brand New Day': [BRAND_NEW_DAY, twin] },
      {},
      {},
      {
        ...posterRoute,
        posterPathsByMovieId: { ...posterRoute.posterPathsByMovieId, [twin.id]: ['/spider.jpg'] },
      },
    )

    const match = await identifyFilm(
      context,
      screenedIn('Spider-Man: Nový deň UKR', 2026, { posterUrls: [CINEMA_POSTER] }),
    )

    expect(match).toEqual({ evidence: 'unmatched', film: null })
  })

  it('admits a film a proposed query finds under a title one letter from the printed one', async () => {
    stubCatalogues(
      { 'Tango pro 3': [{ id: 1751307, title: 'Tango pro 3', releaseDate: '2026-02-05' }] },
      {},
      {},
      { proposedQueries: ['Tango pro 3', 'Tango for Three'] },
    )

    expect(await identifyFilm(context, screenedIn('Tango pre 3', 2026))).toMatchObject({
      evidence: 'title',
      film: { tmdbId: 1751307 },
    })
  })

  it('keeps a namesake a proposed query finds alone tied with the ones the title already found', async () => {
    stubCatalogues(
      {
        Potopa: [
          { id: 1567441, title: 'Potopa', releaseDate: '2025-09-04' },
          { id: 1500001, title: 'Potopa', releaseDate: '2025-03-01' },
        ],
        'The Flood': [
          { id: 1091275, title: 'Potopa', originalTitle: 'Le Déluge', releaseDate: '2024-12-25' },
        ],
      },
      {},
      {},
      { proposedQueries: ['The Flood'] },
    )

    const match = await identifyFilm(
      context,
      screenedIn('Potopa', 2026, { productionYears: [2025] }),
    )

    expect(match).toEqual({ evidence: 'unmatched', film: null })
  })

  it('leaves a title unmatched when a proposed query finds a film only the model named', async () => {
    stubCatalogues(
      {
        'If Pigeons Turned to Gold': [
          { id: 1616833, title: 'Kdyby se holubi proměnili ve zlato', releaseDate: '2026-09-24' },
        ],
      },
      {},
      {},
      { proposedQueries: ['If Pigeons Turned to Gold'] },
    )

    const match = await identifyFilm(context, screenedIn('Keby sa holuby premenili na zlato', 2026))

    expect(match).toEqual({ evidence: 'unmatched', film: null })
  })

  it('admits the film the model picks among the candidates when the stated year corroborates it', async () => {
    const relatives = { id: 1658840, title: 'Родичі', releaseDate: '2026-03-12' }
    const namesake = { id: 1500002, title: 'Rodina', releaseDate: '2019-05-01' }
    stubCatalogues(
      { Rodina: [namesake], Relatives: [relatives] },
      {},
      {},
      { proposedQueries: ['Relatives'], selectedTmdbId: relatives.id },
    )

    const match = await identifyFilm(
      context,
      screenedIn('Rodina', 2026, { productionYears: [2026] }),
    )

    expect(match).toMatchObject({ evidence: 'model', film: { tmdbId: relatives.id } })
  })

  it('refuses the model’s pick when the cinema printed nothing to corroborate it', async () => {
    const relatives = { id: 1658840, title: 'Родичі', releaseDate: '2026-03-12' }
    stubCatalogues(
      { Relatives: [relatives] },
      {},
      {},
      { proposedQueries: ['Relatives'], selectedTmdbId: relatives.id },
    )

    expect(await identifyFilm(context, screenedIn('Rodina', 2026))).toEqual({
      evidence: 'unmatched',
      film: null,
    })
  })

  it('refuses the model’s pick when the stated year contradicts it', async () => {
    const older = { id: 834371, title: 'May B', releaseDate: '2021-06-01' }
    stubCatalogues(
      { 'May B': [older] },
      {},
      {},
      { proposedQueries: ['May B'], selectedTmdbId: older.id },
    )

    const match = await identifyFilm(
      context,
      screenedIn('MAY B (1981)', 2026, { productionYears: [1981] }),
    )

    expect(match).toEqual({ evidence: 'unmatched', film: null })
  })

  it('leaves a title unmatched when the model picks no candidate', async () => {
    const relatives = { id: 1658840, title: 'Родичі', releaseDate: '2026-03-12' }
    stubCatalogues(
      { Relatives: [relatives] },
      {},
      {},
      { proposedQueries: ['Relatives'], selectedTmdbId: null },
    )

    const match = await identifyFilm(
      context,
      screenedIn('Rodina', 2026, { productionYears: [2026] }),
    )

    expect(match).toEqual({ evidence: 'unmatched', film: null })
  })

  it('leaves a title unmatched and carries on when the model does not answer', async () => {
    const log = vi.fn()
    stubCatalogues({}, {}, {}, { modelFailsWith: 529 })

    expect(await identifyFilm(withModel({ log }), screenedIn('Tango pre 3', 2026))).toEqual({
      evidence: 'unmatched',
      film: null,
    })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('stays unresolved'))
  })

  it('does not ask the model when none is configured', async () => {
    const fetchSpy = stubCatalogues({}, {}, {}, posterRoute)

    await identifyFilm(
      buildContext(),
      screenedIn('Spider-Man: Nový deň UKR', 2026, { posterUrls: [CINEMA_POSTER] }),
    )

    expect(toRequestedHosts(fetchSpy)).not.toContain(FAKE_MODEL_HOST)
  })

  it('tells the model which language the listings are in', async () => {
    const fetchSpy = stubCatalogues({}, {}, {}, { proposedQueries: [] })

    await identifyFilm(context, screenedIn('Rodina', 2026))

    const modelCall = fetchSpy.mock.calls.find(
      ([input]) => toRequestUrl(input).hostname === FAKE_MODEL_HOST,
    )
    const body = String(modelCall?.[1]?.body)

    expect(body).toContain('in Slovak')
    expect(body).toContain('Czech distributor title')
  })
})
