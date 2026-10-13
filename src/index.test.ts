import { afterEach, describe, expect, it, vi } from 'vitest'

import { screenedIn, stubCatalogues, toRequestUrl } from './__fixtures__/fakeCatalogues.js'
import { createFilmResolver, FilmLookupError } from './index.js'

const odysea = { Odysea: [{ id: 42, title: 'Odysea', originalTitle: 'The Odyssey' }] }

function toResolver(language: string) {
  return createFilmResolver({
    tmdb: { readAccessToken: 'test-token', language },
    userAgent: 'film-identity-tests',
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createFilmResolver', () => {
  it('asks TMDB in the language its own configuration names', async () => {
    const fetchSpy = stubCatalogues(odysea)
    const slovak = toResolver('sk-SK')
    const czech = toResolver('cs-CZ')

    await slovak.identify(screenedIn('Odysea', 2026))
    const slovakCalls = fetchSpy.mock.calls.length
    await czech.identify(screenedIn('Odysea', 2026))

    const languages = fetchSpy.mock.calls.map(([input]) =>
      toRequestUrl(input).searchParams.get('language'),
    )

    expect(new Set(languages.slice(0, slovakCalls))).toEqual(new Set(['sk-SK']))
    expect(new Set(languages.slice(slovakCalls))).toEqual(new Set(['cs-CZ']))
  })

  it('throws a FilmLookupError naming TMDB when TMDB refuses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }))

    const identifying = toResolver('sk-SK').identify(screenedIn('Odysea', 2026))

    await expect(identifying).rejects.toBeInstanceOf(FilmLookupError)
    await expect(identifying).rejects.toMatchObject({ source: 'tmdb' })
  })
})
