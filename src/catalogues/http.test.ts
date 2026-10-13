import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { buildContext } from '../__fixtures__/fakeCatalogues.js'
import { FilmLookupError } from './errors.js'
import { fetchJson } from './http.js'

const context = buildContext()

/**
 * Answers each request with the next status in turn, then with 200, always with the same body.
 */
function stubStatuses(statuses: number[], body = '"ok"'): ReturnType<typeof vi.fn> {
  const remaining = [...statuses]
  const fetchMock = vi.fn(async () => new Response(body, { status: remaining.shift() ?? 200 }))

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

/**
 * Fakes the clock so the retry backoff is skipped rather than waited out.
 */
async function fetchWithClock(schema: z.ZodType<unknown> = z.string()): Promise<unknown> {
  vi.useFakeTimers({ toFake: ['setTimeout'] })

  const pending = fetchJson(context, 'https://example.org', 'tmdb', schema)

  // Marks a rejection handled: it settles before the caller attaches its expectation.
  pending.catch(() => undefined)
  await vi.runAllTimersAsync()

  return pending
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('fetchJson', () => {
  it('asks again after a server error', async () => {
    const fetchMock = stubStatuses([503, 200])

    expect(await fetchWithClock()).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('asks again after a rate limit', async () => {
    const fetchMock = stubStatuses([429, 200])

    expect(await fetchWithClock()).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not ask again after a client error', async () => {
    const fetchMock = stubStatuses([404, 200])

    await expect(fetchWithClock()).rejects.toThrow('status 404')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after the retries are spent', async () => {
    const fetchMock = stubStatuses([503, 503, 503, 200])

    await expect(fetchWithClock()).rejects.toThrow('status 503')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('reports a body of the wrong shape as a lookup failure from the service', async () => {
    stubStatuses([], '{"results":"none"}')

    const error: unknown = await fetchWithClock(z.object({ results: z.array(z.unknown()) })).catch(
      (rejection: unknown) => rejection,
    )

    expect(error).toBeInstanceOf(FilmLookupError)
    expect(error).toMatchObject({ source: 'tmdb', message: expect.stringContaining('shape') })
  })
})
