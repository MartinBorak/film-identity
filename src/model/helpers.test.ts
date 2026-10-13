import { describe, expect, it } from 'vitest'

import { buildContext, screenedIn } from '../__fixtures__/fakeCatalogues.js'
import { FilmLookupError } from '../catalogues/errors.js'
import { toEvidence } from '../resolve/evidence.js'
import { findJson } from './helpers.js'
import { proposeSearchQueries } from './queryProposer.js'

const ARRAY = /\[.*\]/su

describe('findJson', () => {
  it('finds JSON the model wrapped in prose', () => {
    expect(findJson('Here are my queries:\n["Odyssey", "Odysseia"]\nGood luck.', ARRAY)).toEqual([
      'Odyssey',
      'Odysseia',
    ])
  })

  it('finds nothing where the prose has brackets of its own', () => {
    expect(findJson('I would try [these] queries: ["Odyssey"]', ARRAY)).toBeUndefined()
  })
})

describe('proposeSearchQueries', () => {
  it('reports an unreadable answer as the model failing, not as a crash', async () => {
    const context = buildContext({
      model: {
        ask: () => Promise.resolve('I would try [these] queries: ["Odyssey"]'),
        listingLanguage: 'Slovak',
      },
    })
    const evidence = toEvidence(screenedIn('Odysea', 2026))

    await expect(proposeSearchQueries(context, ['Odysea'], evidence)).rejects.toMatchObject({
      constructor: FilmLookupError,
      source: 'model',
    })
  })
})
