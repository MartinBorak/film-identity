import { describe, expect, it } from 'vitest'

import { titlesMatch, titlesNearlyMatch, toTitleCandidates, toTitleComponents } from './titles.js'

// Examples are real titles from Bratislava cinemas unless noted.
describe('titlesMatch', () => {
  it('matches across letter case', () => {
    expect(titlesMatch('BARDOTKY', 'Bardotky')).toBe(true)
  })

  it('matches across diacritics', () => {
    expect(titlesMatch('Insidious: Sú medzi námi', 'Insidious: Sú medzi nami')).toBe(true)
  })

  // Ȏ is U+020E, O with an inverted breve, where other cinemas print Ô.
  it('matches a lookalike letter', () => {
    expect(titlesMatch('OSEM NȎH A MILIÓN FOLLOWEROV', 'Osem nôh a milión followerov')).toBe(true)
  })

  it('matches an apostrophe against the ľ it stands in for', () => {
    expect(titlesMatch("Tajomstvo krištál'ovej planéty", 'TAJOMSTVO KRIŠTÁĽOVEJ PLANÉTY')).toBe(
      true,
    )
  })

  it('matches across whitespace, including a non-breaking space', () => {
    expect(titlesMatch('film o láske', 'film o laske')).toBe(true)
  })

  // A stroke is not a combining mark, so ł and đ survive NFD and stripping marks.
  it('matches letters that have no Unicode decomposition', () => {
    expect(titlesMatch('Boże Ciało', 'Boze Cialo')).toBe(true)
    expect(titlesMatch('Đavolja kičma', 'Davolja kicma')).toBe(true)
  })

  // Slovak and Czech titles of one film.
  it('does not match two languages, which only TMDB can safely resolve', () => {
    expect(titlesMatch('Vzbura', 'Vzpoura')).toBe(false)
  })

  it('does not match a missing letter', () => {
    expect(titlesMatch('Psie hvezdy', 'Psie hviezdy')).toBe(false)
  })

  it('does not match two genuinely different films', () => {
    expect(titlesMatch('Odysea', 'Odyssey')).toBe(false)
  })
})

describe('titlesNearlyMatch', () => {
  it('matches a title one letter short of another', () => {
    expect(titlesNearlyMatch('Psie hvezdy', 'Psie hviezdy')).toBe(true)
  })

  // Czech and Slovak titles of one film.
  it('does not match two short titles two edits apart', () => {
    expect(titlesNearlyMatch('Vzpoura', 'Vzbura')).toBe(false)
  })

  it('allows two edits once a title is long enough for them to be a small difference', () => {
    expect(
      titlesNearlyMatch(
        'Klenoty žánrového filmu: Po vecerke',
        'Klenoty žánrového filmu: Po večierke',
      ),
    ).toBe(true)
  })

  it('never matches titles that are numbered differently', () => {
    expect(titlesNearlyMatch('Kavej 2', 'Kavej 3')).toBe(false)
    expect(titlesNearlyMatch('Toy Story 5', 'Toy Story')).toBe(false)
  })
})

describe('toTitleCandidates', () => {
  it('offers the whole title first', () => {
    expect(toTitleCandidates('Bardotky')).toEqual(['Bardotky'])
    expect(toTitleCandidates('Kino pre deti: AUTÁ')[0]).toBe('Kino pre deti: AUTÁ')
  })

  it('offers the text after a colon, which is where a strand prefix leaves the film', () => {
    expect(toTitleCandidates('Kino pre deti: AUTÁ')).toContain('AUTÁ')
    expect(toTitleCandidates('Klenoty žánrového filmu: NA JEDNU NOC')).toContain('NA JEDNU NOC')
  })

  it('splits at the first colon, keeping a colon that belongs to the film', () => {
    expect(toTitleCandidates('Kino pre deti: TOM A JERRY: MAGICKÝ KOMPAS')).toEqual([
      'Kino pre deti: TOM A JERRY: MAGICKÝ KOMPAS',
      'TOM A JERRY: MAGICKÝ KOMPAS',
    ])
  })

  it('never offers the text before a colon', () => {
    expect(toTitleCandidates('Insidious: Sú medzi nami')).not.toContain('Insidious')
  })

  it('offers both sides of a spaced dash, since a label can trail either way', () => {
    expect(toTitleCandidates('Harry Potter a Kameň mudrcov - 25. výročie')).toContain(
      'Harry Potter a Kameň mudrcov',
    )
  })

  it('leaves a hyphen inside a word alone', () => {
    expect(toTitleCandidates('Spider-Man: Nový deň')).toEqual(['Spider-Man: Nový deň', 'Nový deň'])
  })

  it('splits on an em dash and a figure dash, not only a hyphen', () => {
    expect(toTitleCandidates('Harry Potter a Kameň mudrcov — 25. výročie')).toContain(
      'Harry Potter a Kameň mudrcov',
    )
    expect(toTitleCandidates('Harry Potter a Kameň mudrcov ‒ 25. výročie')).toContain(
      'Harry Potter a Kameň mudrcov',
    )
  })

  it('drops a bracketed label from every part, not just the whole title', () => {
    expect(toTitleCandidates('Ozveny svetových festivalov: MUCHY (FK)')).toContain('MUCHY')
  })

  it('recovers the bare title from a square-bracketed label', () => {
    expect(toTitleCandidates('Potopa [Oscar: slovenská nominácia]')).toContain('Potopa')
  })

  it('recovers the bare title from a bracketed anniversary tag', () => {
    expect(toTitleCandidates('Harry Potter a Kameň mudrcov (25. výročie)')).toContain(
      'Harry Potter a Kameň mudrcov',
    )
  })

  it('never splits on a plus', () => {
    expect(toTitleCandidates('Pozdravy z Rodosu + Zakorenení vo vode')).toEqual([
      'Pozdravy z Rodosu + Zakorenení vo vode',
    ])
  })
})

describe('toTitleComponents', () => {
  it('reads an ordinary title as a single component', () => {
    expect(toTitleComponents('Bardotky')).toEqual(['Bardotky'])
  })

  it('splits a bill of two films in the order they were printed', () => {
    expect(toTitleComponents('Pozdravy z Rodosu + Zakorenení vo vode')).toEqual([
      'Pozdravy z Rodosu',
      'Zakorenení vo vode',
    ])
  })

  it('splits a film from the talk billed after it', () => {
    expect(toTitleComponents('20. VÝROČIE FILMU WHOLETRAIN + beseda s režisérom')).toEqual([
      '20. VÝROČIE FILMU WHOLETRAIN',
      'beseda s režisérom',
    ])
  })

  // Invented, like the next test: the corpus has no longer bill and no plus inside a title.
  it('splits every component of a longer bill', () => {
    expect(toTitleComponents('Pozdravy z Rodosu + Zakorenení vo vode + Bardotky')).toEqual([
      'Pozdravy z Rodosu',
      'Zakorenení vo vode',
      'Bardotky',
    ])
  })

  it('leaves an unspaced plus inside a title alone', () => {
    expect(toTitleComponents('Bardotky+')).toEqual(['Bardotky+'])
    expect(toTitleComponents('Bardotky+Odysea')).toEqual(['Bardotky+Odysea'])
  })
})
