import { describe, expect, it } from 'vitest'

import { groupRelatedTitles } from './groupTitles.js'

/*
 * Titles are real ones collected from Bratislava cinemas.
 */
describe('groupRelatedTitles', () => {
  it('leaves unrelated titles in groups of their own', () => {
    expect(groupRelatedTitles(['Odysea', 'Bardotky'])).toEqual([['Odysea'], ['Bardotky']])
  })

  it('groups titles that differ only in spelling', () => {
    expect(groupRelatedTitles(['Bardotky', 'BARDOTKY'])).toEqual([['Bardotky', 'BARDOTKY']])
  })

  it('groups a strand-prefixed title with the plain title another cinema prints', () => {
    expect(groupRelatedTitles(['Tajomstvo džungle', 'Kino pre deti: TAJOMSTVO DŽUNGLE'])).toEqual([
      ['Tajomstvo džungle', 'Kino pre deti: TAJOMSTVO DŽUNGLE'],
    ])
  })

  it('groups a strand-prefixed title whichever order the two arrive in', () => {
    expect(groupRelatedTitles(['Kino pre deti: TAJOMSTVO DŽUNGLE', 'Tajomstvo džungle'])).toEqual([
      ['Kino pre deti: TAJOMSTVO DŽUNGLE', 'Tajomstvo džungle'],
    ])
  })

  // The bracketed and strand spellings don't match each other; only the bare title links them.
  it('merges two existing groups when a later title bridges them', () => {
    expect(
      groupRelatedTitles([
        'Harry Potter a Kameň mudrcov (25. výročie)',
        'Klenoty žánrového filmu: Harry Potter a Kameň mudrcov',
        'Harry Potter a Kameň mudrcov',
      ]),
    ).toEqual([
      [
        'Harry Potter a Kameň mudrcov (25. výročie)',
        'Klenoty žánrového filmu: Harry Potter a Kameň mudrcov',
        'Harry Potter a Kameň mudrcov',
      ],
    ])
  })

  it('groups transitively across five spellings of one film', () => {
    const spellings = [
      'Harry Potter a Kameň mudrcov',
      'Harry Potter a Kameň mudrcov (25. výročie)',
      'Harry Potter a Kameň mudrcov - 25. výročie',
      'Harry Potter a kameň mudrcov 25.výročie',
      'Klenoty žánrového filmu: Harry Potter a Kameň mudrcov',
    ]

    expect(groupRelatedTitles(spellings)).toEqual([spellings])
  })

  // Both split to "Romulus", which only candidate-to-candidate matching would merge.
  it('never merges two titles on their split forms alone', () => {
    expect(groupRelatedTitles(['Alien: Romulus', 'Predator: Romulus'])).toEqual([
      ['Alien: Romulus'],
      ['Predator: Romulus'],
    ])
  })

  it('groups a misspelled title with the correct spelling another cinema prints', () => {
    expect(groupRelatedTitles(['Psie hviezdy', 'Psie hvezdy'])).toEqual([
      ['Psie hviezdy', 'Psie hvezdy'],
    ])
  })

  // One character apart, like a typo, but a sequel.
  it('keeps two differently numbered titles apart however close they read', () => {
    expect(groupRelatedTitles(['Kavej 2', 'Kavej 3'])).toEqual([['Kavej 2'], ['Kavej 3']])
  })

  // Why the text before a colon is never a candidate form.
  it('keeps a sequel apart from the franchise it is named after', () => {
    expect(groupRelatedTitles(['Insidious', 'Insidious: Sú medzi nami'])).toEqual([
      ['Insidious'],
      ['Insidious: Sú medzi nami'],
    ])
  })

  it('orders groups and members by first appearance', () => {
    expect(groupRelatedTitles(['ODYSEA', 'Bardotky', 'Odysea'])).toEqual([
      ['ODYSEA', 'Odysea'],
      ['Bardotky'],
    ])
  })

  it('orders a group by its first occurrence even when a title repeats', () => {
    expect(groupRelatedTitles(['Odysea', 'Bardotky', 'Odysea'])).toEqual([
      ['Odysea', 'Odysea'],
      ['Bardotky'],
    ])
  })

  it('returns nothing for no titles', () => {
    expect(groupRelatedTitles([])).toEqual([])
  })
})
