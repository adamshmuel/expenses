import { describe, expect, it, vi, beforeEach } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import authReducer, { login, logout, setAccessToken, clearErrors } from './authSlice'
import * as authApi from '../api/authApi'

vi.mock('../api/authApi')

const makeStore = () => configureStore({ reducer: { auth: authReducer } })
const user = { id: '1', username: 'adam', email: 'adam@example.com' }

describe('authSlice', () => {
  beforeEach(() => vi.resetAllMocks())

  it('starts logged out', () => {
    const { auth } = makeStore().getState()
    expect(auth.user).toBeNull()
    expect(auth.accessToken).toBeNull()
    expect(auth.status).toBe('idle')
  })

  it('stores the user and access token after a successful login', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ user, accessToken: 'abc123' })
    const store = makeStore()
    await store.dispatch(login({ username: 'adam', password: 'password123' }))
    const { auth } = store.getState()
    expect(auth.user).toEqual(user)
    expect(auth.accessToken).toBe('abc123')
    expect(auth.status).toBe('succeeded')
  })

  it('keeps the server message when login fails', async () => {
    vi.mocked(authApi.login).mockRejectedValue({
      message: 'Username or password is incorrect.',
      fieldErrors: {},
    })
    const store = makeStore()
    await store.dispatch(login({ username: 'adam', password: 'wrong' }))
    const { auth } = store.getState()
    expect(auth.error).toBe('Username or password is incorrect.')
    expect(auth.user).toBeNull()
    expect(auth.status).toBe('failed')
  })

  it('keeps field errors separate from the general error', async () => {
    vi.mocked(authApi.login).mockRejectedValue({
      message: 'Validation failed.',
      fieldErrors: { username: 'Username is required.' },
    })
    const store = makeStore()
    await store.dispatch(login({ username: '', password: 'x' }))
    expect(store.getState().auth.fieldErrors).toEqual({ username: 'Username is required.' })
  })

  it('clears the user on logout', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ user, accessToken: 'abc123' })
    vi.mocked(authApi.logout).mockResolvedValue(undefined)
    const store = makeStore()
    await store.dispatch(login({ username: 'adam', password: 'password123' }))
    await store.dispatch(logout())
    const { auth } = store.getState()
    expect(auth.user).toBeNull()
    expect(auth.accessToken).toBeNull()
  })

  it('replaces only the access token when it is refreshed', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ user, accessToken: 'old' })
    const store = makeStore()
    await store.dispatch(login({ username: 'adam', password: 'password123' }))
    store.dispatch(setAccessToken('new'))
    const { auth } = store.getState()
    expect(auth.accessToken).toBe('new')
    expect(auth.user).toEqual(user)
  })

  it('clears errors when asked', async () => {
    vi.mocked(authApi.login).mockRejectedValue({ message: 'Nope.', fieldErrors: { username: 'Taken.' } })
    const store = makeStore()
    await store.dispatch(login({ username: 'adam', password: 'x' }))
    store.dispatch(clearErrors())
    const { auth } = store.getState()
    expect(auth.error).toBeNull()
    expect(auth.fieldErrors).toEqual({})
  })
})
