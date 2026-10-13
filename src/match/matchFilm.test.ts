import { describe, expect, it } from 'vitest'

import {
  narrowToFilmsMadeAround,
  pickBestMatch,
  pickCorroboratedMatch,
  pickFilmRunningForStatedTime,
  type DirectedFilm,
  type FilmCandidate,
  type FilmEvidence,
} from './matchFilm.js'

function buildFilmCandidate(candidate: Partial<FilmCandidate> = {}): FilmCandidate {
  return {
    tmdbId: 1,
    titles: ['A Film'],
    releaseYear: 2026,
    directors: [],
    cast: [],
    runtimeMinutes: null,
    ...candidate,
  }
}

function screenedIn(screeningYear: number, evidence: Partial<FilmEvidence> = {}): FilmEvidence {
  return {
    screeningYear,
    productionYears: [],
    directors: [],
    synopses: [],
    runtimesInMinutes: [],
    ...evidence,
  }
}

describe('pickBestMatch', () => {
  it('matches a title against the film of the same name', () => {
    const film = buildFilmCandidate({ tmdbId: 42, titles: ['Odysea'] })

    expect(pickBestMatch(['Odysea'], [film], screenedIn(2026))).toBe(film)
  })

  it('matches a title that differs only in case and diacritics', () => {
    const film = buildFilmCandidate({ tmdbId: 42, titles: ['Osem nôh a milión followerov'] })

    expect(pickBestMatch(['OSEM NOH A MILION FOLLOWEROV'], [film], screenedIn(2026))).toBe(film)
  })

  it('matches on a title only the wider title set carries', () => {
    const film = buildFilmCandidate({ tmdbId: 42, titles: ['Vzbura', 'Mutiny', 'Vzpoura'] })

    expect(pickBestMatch(['Vzpoura'], [film], screenedIn(2026))).toBe(film)
  })

  it('prefers an exact match to a better-ranked one that does not match', () => {
    const ranked = buildFilmCandidate({ tmdbId: 1, titles: ['Príbelská vzbura Janka Kráľa'] })
    const exact = buildFilmCandidate({ tmdbId: 2, titles: ['Vzbura'] })

    expect(pickBestMatch(['Vzbura'], [ranked, exact], screenedIn(2026))).toBe(exact)
  })

  it('prefers a whole-title match to a split-candidate match on a better-ranked film', () => {
    const onSplit = buildFilmCandidate({ tmdbId: 1, titles: ['Autá'] })
    const onWhole = buildFilmCandidate({ tmdbId: 2, titles: ['Kino pre deti: Autá'] })

    expect(
      pickBestMatch(['Kino pre deti: Autá', 'Autá'], [onSplit, onWhole], screenedIn(2026)),
    ).toBe(onWhole)
  })

  it('prefers the film a title names to a better-ranked film one edit away', () => {
    const nearMiss = buildFilmCandidate({ tmdbId: 1, titles: ['Psie hviezdy'] })
    const named = buildFilmCandidate({ tmdbId: 2, titles: ['Psie hvezdy'] })

    expect(pickBestMatch(['Psie hvezdy'], [nearMiss, named], screenedIn(2026))).toBe(named)
  })

  describe('the edit-distance fallback', () => {
    it('matches through a single-character typo', () => {
      const film = buildFilmCandidate({ tmdbId: 42, titles: ['Psie hviezdy'], releaseYear: 2025 })

      expect(pickBestMatch(['Psie hvezdy'], [film], screenedIn(2026))).toBe(film)
    })

    // Slovak and Czech titles of one film.
    it('does not pair two short titles two edits apart', () => {
      const film = buildFilmCandidate({ tmdbId: 42, titles: ['Vzbura'] })

      expect(pickBestMatch(['Vzpoura'], [film], screenedIn(2026))).toBeNull()
    })

    it('allows two edits once a title is long enough for them to be a small difference', () => {
      const film = buildFilmCandidate({
        tmdbId: 42,
        titles: ['Klenoty žánrového filmu: Po večierke'],
        releaseYear: 2025,
      })

      expect(pickBestMatch(['Klenoty žánrového filmu: Po vecerke'], [film], screenedIn(2026))).toBe(
        film,
      )
    })

    it('rejects a near miss on a film released after the screening', () => {
      const film = buildFilmCandidate({ tmdbId: 42, titles: ['Psie hviezdy'], releaseYear: 2027 })

      expect(pickBestMatch(['Psie hvezdy'], [film], screenedIn(2026))).toBeNull()
    })

    it('rejects a near miss on a film TMDB gives no release date', () => {
      const film = buildFilmCandidate({ tmdbId: 42, titles: ['Psie hviezdy'], releaseYear: null })

      expect(pickBestMatch(['Psie hvezdy'], [film], screenedIn(2026))).toBeNull()
    })

    it('accepts a near miss on a film released long before the screening', () => {
      const film = buildFilmCandidate({ tmdbId: 42, titles: ['Psie hviezdy'], releaseYear: 1978 })

      expect(pickBestMatch(['Psie hvezdy'], [film], screenedIn(2026))).toBe(film)
    })
  })

  it('returns null when nothing matches', () => {
    const film = buildFilmCandidate({ tmdbId: 42, titles: ['Madama Butterfly'] })

    expect(pickBestMatch(['SNP v krátkych filmoch'], [film], screenedIn(2026))).toBeNull()
  })

  describe('films sharing a title', () => {
    it('returns null when two films answer to the title', () => {
      const silent = buildFilmCandidate({ tmdbId: 1, titles: ['Madame Butterfly'] })
      const remake = buildFilmCandidate({ tmdbId: 2, titles: ['Madame Butterfly'] })

      expect(pickBestMatch(['Madame Butterfly'], [silent, remake], screenedIn(2026))).toBeNull()
    })

    it('settles a tie the release year rules one of them out of', () => {
      const screened = buildFilmCandidate({ tmdbId: 1, titles: ['Madame Butterfly'] })
      const unreleased = buildFilmCandidate({
        tmdbId: 2,
        titles: ['Madame Butterfly'],
        releaseYear: 2027,
      })

      expect(pickBestMatch(['Madame Butterfly'], [screened, unreleased], screenedIn(2026))).toBe(
        screened,
      )
    })

    it('settles a tie on the year the cinema says the film was made', () => {
      const wrong = buildFilmCandidate({ tmdbId: 1, titles: ['Aftersun'], releaseYear: 2006 })
      const screened = buildFilmCandidate({ tmdbId: 2, titles: ['Aftersun'], releaseYear: 2022 })

      expect(
        pickBestMatch(
          ['Aftersun'],
          [wrong, screened],
          screenedIn(2026, { productionYears: [2022] }),
        ),
      ).toBe(screened)
    })

    // TMDB does hold two films called Aftersun released in 2022.
    it('settles a tie the year cannot, on the director', () => {
      const other = buildFilmCandidate({
        tmdbId: 1,
        titles: ['Aftersun'],
        releaseYear: 2022,
        directors: ['Lluís Galter'],
      })
      const screened = buildFilmCandidate({
        tmdbId: 2,
        titles: ['Aftersun'],
        releaseYear: 2022,
        directors: ['Charlotte Wells'],
      })

      expect(
        pickBestMatch(
          ['Aftersun'],
          [other, screened],
          screenedIn(2026, { productionYears: [2022], directors: ['Charlotte Wells'] }),
        ),
      ).toBe(screened)
    })

    // One year off is within the production-year tolerance.
    it('keeps a lone match whose year the cinema states differently', () => {
      const film = buildFilmCandidate({ tmdbId: 1, titles: ['Odysea'], releaseYear: 2026 })

      expect(pickBestMatch(['Odysea'], [film], screenedIn(2026, { productionYears: [2025] }))).toBe(
        film,
      )
    })

    it('refuses a lone match by a director other than the one the cinema named', () => {
      const short = buildFilmCandidate({
        tmdbId: 1,
        titles: ['Спасение', 'Spasenie'],
        releaseYear: 2024,
        directors: ['Микита Добринін'],
      })

      expect(
        pickBestMatch(['SPASENIE'], [short], screenedIn(2026, { directors: ['EMIN ALPER'] })),
      ).toBeNull()
    })

    it('refuses a lone match made more than a year from when the cinema says', () => {
      const short = buildFilmCandidate({ tmdbId: 1, titles: ['Spasenie'], releaseYear: 2024 })

      expect(
        pickBestMatch(['Spasenie'], [short], screenedIn(2026, { productionYears: [2026] })),
      ).toBeNull()
    })

    it('keeps a lone match whose directors TMDB has not supplied yet', () => {
      const film = buildFilmCandidate({ tmdbId: 1, titles: ['Spasenie'], directors: [] })

      expect(
        pickBestMatch(['Spasenie'], [film], screenedIn(2026, { directors: ['EMIN ALPER'] })),
      ).toBe(film)
    })

    it('keeps a lone match by the director the cinema named, spelling aside', () => {
      const film = buildFilmCandidate({
        tmdbId: 1,
        titles: ['Spasenie'],
        directors: ['Emin Alper'],
      })

      expect(
        pickBestMatch(['Spasenie'], [film], screenedIn(2026, { directors: ['EMIN ALPER'] })),
      ).toBe(film)
    })

    it('settles a tie on the people the blurb names', () => {
      const older = buildFilmCandidate({
        tmdbId: 1,
        titles: ['Digger'],
        releaseYear: 2021,
        cast: ['Some Actor'],
      })
      const screened = buildFilmCandidate({
        tmdbId: 2,
        titles: ['Digger'],
        releaseYear: 2026,
        cast: ['Tom Cruise', 'Riz Ahmed'],
      })

      expect(
        pickBestMatch(
          ['Digger'],
          [older, screened],
          screenedIn(2026, {
            synopses: ['V novej čiernej komédii sa Tom Cruise predstaví ako magnát.'],
          }),
        ),
      ).toBe(screened)
    })

    it('reads a name in the blurb through its diacritics', () => {
      const other = buildFilmCandidate({ tmdbId: 1, titles: ['Digger'], cast: ['Some Actor'] })
      const screened = buildFilmCandidate({
        tmdbId: 2,
        titles: ['Digger'],
        cast: ['Sandra Hüller'],
      })

      expect(
        pickBestMatch(
          ['Digger'],
          [other, screened],
          screenedIn(2026, { synopses: ['hrá Sandra Huller'] }),
        ),
      ).toBe(screened)
    })

    it('does not read a one-word credit as naming the film', () => {
      const other = buildFilmCandidate({ tmdbId: 1, titles: ['Digger'], cast: ['Some Actor'] })
      const screened = buildFilmCandidate({ tmdbId: 2, titles: ['Digger'], cast: ['Digger'] })

      expect(
        pickBestMatch(
          ['Digger'],
          [other, screened],
          screenedIn(2026, { synopses: ['magnát Digger Rockwell'] }),
        ),
      ).toBeNull()
    })

    it('returns null when neither the year nor the director separates them', () => {
      const first = buildFilmCandidate({ tmdbId: 1, titles: ['Aftersun'], releaseYear: 2022 })
      const second = buildFilmCandidate({ tmdbId: 2, titles: ['Aftersun'], releaseYear: 2022 })

      expect(
        pickBestMatch(['Aftersun'], [first, second], screenedIn(2026, { productionYears: [2022] })),
      ).toBeNull()
    })
  })

  it('returns null when TMDB found nothing at all', () => {
    expect(pickBestMatch(['Odysea'], [], screenedIn(2026))).toBeNull()
  })
})

describe('pickCorroboratedMatch', () => {
  it('admits a film no title matched, on the director the cinema printed', () => {
    const film = buildFilmCandidate({ tmdbId: 1384216, directors: ['Ridley Scott'] })

    expect(pickCorroboratedMatch([film], screenedIn(2026, { directors: ['Ridley Scott'] }))).toBe(
      film,
    )
  })

  it('admits a film on the runtime the cinema printed', () => {
    const film = buildFilmCandidate({ runtimeMinutes: 152 })

    expect(pickCorroboratedMatch([film], screenedIn(2026, { runtimesInMinutes: [152] }))).toBe(film)
  })

  it('refuses to admit a film on the year alone', () => {
    const film = buildFilmCandidate({ releaseYear: 2026 })

    expect(pickCorroboratedMatch([film], screenedIn(2026, { productionYears: [2026] }))).toBeNull()
  })

  it('refuses when the same director directed two of the candidates', () => {
    const early = buildFilmCandidate({ tmdbId: 1, directors: ['Ridley Scott'] })
    const late = buildFilmCandidate({ tmdbId: 2, directors: ['Ridley Scott'] })

    expect(
      pickCorroboratedMatch([early, late], screenedIn(2026, { directors: ['Ridley Scott'] })),
    ).toBeNull()
  })

  it('refuses a corroborated film released after the screening', () => {
    const unreleased = buildFilmCandidate({ releaseYear: 2027, directors: ['Ridley Scott'] })

    expect(
      pickCorroboratedMatch([unreleased], screenedIn(2026, { directors: ['Ridley Scott'] })),
    ).toBeNull()
  })

  it('refuses when the cinemas printed no director and no runtime', () => {
    expect(pickCorroboratedMatch([buildFilmCandidate()], screenedIn(2026))).toBeNull()
  })
})

describe('narrowToFilmsMadeAround', () => {
  // Edmunds Jansons' films on TMDB.
  const directedFilms: DirectedFilm[] = [
    { tmdbId: 580256, releaseYear: 2019 },
    { tmdbId: 1329178, releaseYear: 2024 },
    { tmdbId: 947474, releaseYear: 2026 },
  ]

  it('leaves the one film a director made in the year the cinema printed', () => {
    expect(narrowToFilmsMadeAround(directedFilms, [2026]).map(({ tmdbId }) => tmdbId)).toEqual([
      947474,
    ])
  })

  it('keeps a film TMDB released the year after the one printed', () => {
    expect(narrowToFilmsMadeAround([{ tmdbId: 776717, releaseYear: 2022 }], [2021])).toHaveLength(1)
  })

  it('leaves both films where the director made two that year', () => {
    const sameYear = [...directedFilms, { tmdbId: 1, releaseYear: 2026 }]

    expect(narrowToFilmsMadeAround(sameYear, [2026])).toHaveLength(2)
  })

  it('narrows nothing away where the printed year matches none of them', () => {
    expect(narrowToFilmsMadeAround(directedFilms, [1968])).toEqual(directedFilms)
  })

  it('drops a film TMDB holds no year for where another matches', () => {
    const undated = [...directedFilms, { tmdbId: 645232, releaseYear: null }]

    expect(narrowToFilmsMadeAround(undated, [2026]).map(({ tmdbId }) => tmdbId)).toEqual([947474])
  })
})

describe('pickFilmRunningForStatedTime', () => {
  // 86 against 83 sits exactly at the three-minute tolerance.
  it('picks the film that runs about as long as the cinema said', () => {
    const films = [
      buildFilmCandidate({ tmdbId: 686969, runtimeMinutes: 83 }),
      buildFilmCandidate({ tmdbId: 2, runtimeMinutes: 120 }),
    ]

    expect(pickFilmRunningForStatedTime(films, [86])?.tmdbId).toBe(686969)
  })

  it('refuses a film running nothing like the stated time', () => {
    const film = buildFilmCandidate({ runtimeMinutes: 96 })

    expect(pickFilmRunningForStatedTime([film], [86])).toBeNull()
  })

  it('refuses when the cinemas printed no runtime', () => {
    expect(
      pickFilmRunningForStatedTime([buildFilmCandidate({ runtimeMinutes: 83 })], []),
    ).toBeNull()
  })

  it('refuses when two of the director films run that long', () => {
    const films = [
      buildFilmCandidate({ tmdbId: 1, runtimeMinutes: 83 }),
      buildFilmCandidate({ tmdbId: 2, runtimeMinutes: 85 }),
    ]

    expect(pickFilmRunningForStatedTime(films, [86])).toBeNull()
  })

  it('refuses a film TMDB holds no runtime for', () => {
    expect(pickFilmRunningForStatedTime([buildFilmCandidate()], [86])).toBeNull()
  })
})
