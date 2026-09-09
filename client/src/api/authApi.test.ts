import { describe, expect, it, vi, beforeEach } from 'vitest'
import { httpClient } from './httpClient'
import { login, register, refresh, logout } from './authApi'

const authResponse = {
  user: { id: '1', username: 'adam', email: 'adam@example.com' },
  accessToken: 'abc123',
}

describe('authApi request paths', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(httpClient, 'post').mockResolvedValue({ data: authResponse })
  })

  it('logs in against /users/login', async () => {
    await login({ username: 'adam', password: 'pw' })
    expect(httpClient.post).toHaveBeenCalledWith('/users/login', {
      username: 'adam',
      password: 'pw',
    })
  })

  it('registers against /users/signup', async () => {
    await register({ username: 'adam', email: 'adam@example.com', password: 'pw' })
    expect(httpClient.post).toHaveBeenCalledWith('/users/signup', {
      username: 'adam',
      email: 'adam@example.com',
      password: 'pw',
    })
  })

  it('refreshes against /users/refresh', async () => {
    await refresh()
    expect(httpClient.post).toHaveBeenCalledWith('/users/refresh')
  })

  it('logs out against /users/logout', async () => {
    await logout()
    expect(httpClient.post).toHaveBeenCalledWith('/users/logout')
  })
})
