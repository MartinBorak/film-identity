import { describe, expect, it } from 'vitest'

import { mergeEvidence, toEvidence } from './evidence.js'

describe('toEvidence', () => {
  it('refuses a screening date that is not year-month-day', () => {
    expect(() =>
      toEvidence({ titles: ['Odysea'], screeningYear: 2026, firstScreeningDate: '5-2-2026' }),
    ).toThrow('Listing "Odysea" has firstScreeningDate "5-2-2026", expected YYYY-MM-DD')
  })
})

describe('mergeEvidence', () => {
  it('picks the earliest screening date, however it was padded', () => {
    const merged = mergeEvidence([
      toEvidence({ titles: ['Odysea'], screeningYear: 2026, firstScreeningDate: '2026-10-1' }),
      toEvidence({ titles: ['Odysea'], screeningYear: 2026, firstScreeningDate: '2026-2-5' }),
    ])

    expect(merged.firstScreeningDate).toBe('2026-02-05')
  })
})
