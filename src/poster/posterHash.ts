import { FilmLookupError, type FilmLookupSource } from '../catalogues/errors.js'
import { fetchBytes } from '../catalogues/http.js'
import type { Context } from '../config.js'

/**
 * A difference hash along both rows and columns, 128 bits.
 * Rows alone barely told the right film from the wrong ones.
 */
const GRID_SIZE = 9

// The index of each neighbouring pair along a row or column.
const STEPS = [...Array(GRID_SIZE - 1).keys()]

export type PosterHash = bigint

/**
 * Loads the image library on first use and fails with a clear error when it is not installed.
 * It is an optional peer dependency, needed only when posters are compared.
 */
async function loadSharp(): Promise<typeof import('sharp').default> {
  try {
    return (await import('sharp')).default
  } catch {
    throw new FilmLookupError(
      'Comparing posters needs the optional peer dependency sharp',
      'poster',
    )
  }
}

/**
 * Turns a poster image into a compact fingerprint that stays close for posters that look alike.
 */
export async function hashPoster(image: Uint8Array): Promise<PosterHash> {
  const sharp = await loadSharp()
  const pixels = await sharp(image)
    .grayscale()
    .resize(GRID_SIZE, GRID_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer()

  /**
   * Reads the brightness of one cell in the shrunken grayscale grid.
   */
  function at(row: number, column: number): number {
    return pixels[row * GRID_SIZE + column]
  }

  const alongRows = STEPS.flatMap((row) =>
    STEPS.map((column) => at(row, column) > at(row, column + 1)),
  )
  const alongColumns = STEPS.flatMap((column) =>
    STEPS.map((row) => at(row, column) > at(row + 1, column)),
  )

  return [...alongRows, ...alongColumns].reduce(
    (bits, bit) => (bits << BigInt(1)) | BigInt(bit),
    BigInt(0),
  )
}

/**
 * Counts how many bits differ between two poster hashes; the lower, the more alike the posters.
 */
export function toHashDistance(a: PosterHash, b: PosterHash): number {
  return (a ^ b).toString(2).split('1').length - 1
}

/**
 * Downloads a poster and returns its fingerprint for comparison.
 */
export async function fetchPosterHash(
  context: Context,
  url: string,
  source: FilmLookupSource,
): Promise<PosterHash> {
  return hashPoster(await fetchBytes(context, url, source))
}
