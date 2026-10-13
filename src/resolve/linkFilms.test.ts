import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildContext, toRequestUrl } from '../__fixtures__/fakeCatalogues.js'
import type { Film } from '../types.js'
import { fetchFilmLinks } from './linkFilms.js'

const film: Film = {
  tmdbId: 1,
  imdbId: null,
  wikidataId: null,
  catalogueIds: {},
  title: 'Nový film',
  englishTitle: 'New Film',
  originalTitle: 'New Film',
  releaseYear: 2026,
  runtimeMinutes: null,
  posterPath: null,
  directors: [],
  genreIds: [],
}

// Neither id reaches an item, so only a pairing or a search can.
async function stubWikidata() {
  const item = await readFile(
    new URL('../__fixtures__/wikidata-film.json', import.meta.url),
    'utf8',
  )

  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const action = toRequestUrl(input).searchParams.get('action')

    return Promise.resolve(
      new Response(action === 'wbgetentities' ? item : JSON.stringify({ query: { search: [] } })),
    )
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchFilmLinks', () => {
  it('reads a paired item instead of searching for the film by name', async () => {
    const fetchSpy = await stubWikidata()

    const links = await fetchFilmLinks(buildContext(), [film], new Map([[1, 'Q17167680']]))

    expect(links.get(1)).toMatchObject({ wikidataId: 'Q17167680' })
    expect(links.get(1)?.catalogueIds).toHaveProperty('P2529')
    expect(
      fetchSpy.mock.calls.map(([input]) => toRequestUrl(input).searchParams.get('action')),
    ).not.toContain('wbsearchentities')
  })
})
