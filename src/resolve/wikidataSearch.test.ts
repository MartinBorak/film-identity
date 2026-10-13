import { describe, expect, it } from 'vitest'

import type { Film } from '../types.js'
import { isSameFilm, pickSearchedFilm, type SearchedItem } from './wikidataSearch.js'

const TANGO: Film = {
  tmdbId: 1751307,
  imdbId: null,
  wikidataId: null,
  catalogueIds: {},
  title: 'Tango pro 3',
  englishTitle: 'Tango pro 3',
  originalTitle: 'Tango pro 3',
  releaseYear: 2026,
  runtimeMinutes: null,
  posterPath: null,
  directors: ['Lenka Kny'],
  genreIds: [],
}

function item(fields: Partial<SearchedItem> = {}): SearchedItem {
  return {
    wikidataId: 'Q140514008',
    labels: ['Tango pro 3'],
    years: [2026],
    directors: [],
    imdbId: null,
    tmdbId: null,
    catalogueIds: { P2529: '1810733' },
    ...fields,
  }
}

describe('isSameFilm', () => {
  it('accepts an item named and dated like the film', () => {
    expect(isSameFilm(item(), TANGO)).toBe(true)
  })

  it('reads the label through case and diacritics', () => {
    expect(isSameFilm(item({ labels: ['TANGO PRO 3'] }), TANGO)).toBe(true)
  })

  it('refuses an item with none of the film’s titles', () => {
    expect(isSameFilm(item({ labels: ['Tango'] }), TANGO)).toBe(false)
  })

  it('allows the release a year either side, and no more', () => {
    expect(isSameFilm(item({ years: [2025] }), TANGO)).toBe(true)
    expect(isSameFilm(item({ years: [2024] }), TANGO)).toBe(false)
  })

  it('accepts an undated item, since an absent date rules nothing out', () => {
    expect(isSameFilm(item({ years: [] }), TANGO)).toBe(true)
  })

  it('refuses an item stating another TMDB id', () => {
    expect(isSameFilm(item({ tmdbId: 999 }), TANGO)).toBe(false)
    expect(isSameFilm(item({ tmdbId: 1751307 }), TANGO)).toBe(true)
  })

  it('requires a director to agree where both sides name one', () => {
    expect(isSameFilm(item({ directors: ['Lenka Kny'] }), TANGO)).toBe(true)
    expect(isSameFilm(item({ directors: ['Someone Else'] }), TANGO)).toBe(false)
    expect(isSameFilm(item({ directors: ['Someone Else'] }), { ...TANGO, directors: [] })).toBe(
      true,
    )
  })
})

describe('pickSearchedFilm', () => {
  it('returns the links of the one item that is the film', () => {
    expect(
      pickSearchedFilm([item(), item({ wikidataId: 'Q2', labels: ['Other'] })], TANGO),
    ).toEqual({ wikidataId: 'Q140514008', imdbId: null, catalogueIds: { P2529: '1810733' } })
  })

  it('returns nothing when two items could be the film', () => {
    expect(pickSearchedFilm([item(), item({ wikidataId: 'Q2' })], TANGO)).toBeNull()
  })

  it('returns nothing when no item is the film', () => {
    expect(pickSearchedFilm([item({ labels: ['Other'] })], TANGO)).toBeNull()
  })
})
