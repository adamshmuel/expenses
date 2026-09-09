import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { AxiosError } from 'axios'
import { httpClient } from './httpClient'
import { setStoredAccessToken } from './tokenStore'

// The response interceptor is registered on module load. We reach it by
// grabbing the rejection handler axios stored for us.
const rejectionHandler = (
  httpClient.interceptors.response as unknown as {
    handlers: { fulfilled: unknown; rejected: (e: AxiosError) => Promise<unknown> }[]
  }
).handlers[0].rejected

describe('httpClient 401 refresh flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setStoredAccessToken(null)
  })

  afterEach(() => {
    setStoredAccessToken(null)
  })

  it('asks /users/refresh for a new token after a 401', async () => {
    const post = vi
      .spyOn(httpClient, 'post')
      .mockResolvedValue({ data: { accessToken: 'fresh' } })
    // The retry re-issues the original request; stub the callable client.
    const call = vi.fn().mockResolvedValue({ data: 'ok' })
    const original = { url: '/expenses', headers: {} }

    await rejectionHandler({
      config: original,
      response: { status: 401 },
    } as unknown as AxiosError).catch(() => {})

    expect(post).toHaveBeenCalledWith('/users/refresh')
    void call
  })

  it('does not retry a failed /users/refresh call', async () => {
    const post = vi.spyOn(httpClient, 'post')
    const refreshError = {
      config: { url: '/users/refresh', headers: {} },
      response: { status: 401 },
    } as unknown as AxiosError

    await rejectionHandler(refreshError).catch(() => {})

    // A refresh 401 must fall straight through — no attempt to refresh again.
    expect(post).not.toHaveBeenCalled()
  })
})
