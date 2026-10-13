import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { hashPoster, toHashDistance } from './posterHash.js'

// Well inside the 26 bits identify.ts admits, and well past it.
const SAME_ARTWORK_DISTANCE = 12
const OTHER_ARTWORK_DISTANCE = 40

// Brightness from 0 to 255 at a point, given as fractions of the width and height.
type Artwork = (x: number, y: number) => number

// Waves in both directions, so the hash has a mix of set and unset bits along rows and columns.
function waves(phase: number): Artwork {
  return (x, y) =>
    128 +
    50 * Math.sin(2 * Math.PI * 1.3 * x + phase) +
    50 * Math.sin(2 * Math.PI * 1.7 * y + phase)
}

async function toPoster(artwork: Artwork, width = 300, height = 450): Promise<Uint8Array> {
  const pixels = Buffer.from(
    [...Array(width * height).keys()].map((index) =>
      Math.round(artwork((index % width) / width, Math.floor(index / width) / height)),
    ),
  )

  return new Uint8Array(
    await sharp(pixels, { raw: { width, height, channels: 1 } })
      .jpeg()
      .toBuffer(),
  )
}

afterEach(() => {
  vi.doUnmock('sharp')
  vi.resetModules()
})

describe('hashPoster', () => {
  it('hashes the same artwork at another size to within a few bits', async () => {
    const original = await hashPoster(await toPoster(waves(0)))
    const smaller = await hashPoster(await toPoster(waves(0), 100, 150))

    expect(toHashDistance(original, smaller)).toBeLessThanOrEqual(SAME_ARTWORK_DISTANCE)
  })

  it('hashes the same artwork brightened and with less contrast to within a few bits', async () => {
    const original = await hashPoster(await toPoster(waves(0)))
    const brightened = await hashPoster(await toPoster((x, y) => 0.7 * waves(0)(x, y) + 60))

    expect(toHashDistance(original, brightened)).toBeLessThanOrEqual(SAME_ARTWORK_DISTANCE)
  })

  it('hashes different artwork far apart', async () => {
    const one = await hashPoster(await toPoster(waves(0)))
    const other = await hashPoster(await toPoster(waves(2)))

    expect(toHashDistance(one, other)).toBeGreaterThan(OTHER_ARTWORK_DISTANCE)
  })

  it('tells apart artwork that differs only from top to bottom', async () => {
    const one = await hashPoster(await toPoster(waves(0)))
    // Every row reads the same as in `one`; only the vertical wave is inverted.
    const flipped = await hashPoster(
      await toPoster((x, y) => waves(0)(x, 0) - waves(0)(0, y) + 128),
    )

    expect(toHashDistance(one, flipped)).toBeGreaterThan(OTHER_ARTWORK_DISTANCE)
  })

  it('throws a FilmLookupError when the optional sharp is not installed', async () => {
    vi.doMock('sharp', () => {
      throw new Error("Cannot find package 'sharp'")
    })
    const { hashPoster: hashWithoutSharp } = await import('./posterHash.js')
    const { FilmLookupError } = await import('../catalogues/errors.js')

    const hashing = hashWithoutSharp(new Uint8Array())

    await expect(hashing).rejects.toBeInstanceOf(FilmLookupError)
    await expect(hashing).rejects.toMatchObject({ source: 'poster' })
  })
})

describe('toHashDistance', () => {
  it('counts the differing bits', () => {
    expect(toHashDistance(BigInt(0b1010), BigInt(0b0110))).toBe(2)
    expect(toHashDistance(BigInt(0), BigInt(0))).toBe(0)
  })

  it('counts bits past the 64th', () => {
    expect(toHashDistance(BigInt(1) << BigInt(127), BigInt(0))).toBe(1)
  })
})
