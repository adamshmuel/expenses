import { describe, expect, it } from 'vitest'
import { httpClient } from './httpClient'

describe('httpClient base URL', () => {
  it('falls back to the server root with no /api prefix', () => {
    // No VITE_API_URL is set in the test env, so the fallback is what runs.
    expect(httpClient.defaults.baseURL).toBe('http://localhost:3000')
  })
})
