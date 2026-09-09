import { httpClient, toApiError } from './httpClient'
import { setStoredAccessToken } from './tokenStore'
import type { AuthResponse, LoginCredentials, RegisterDetails } from './types'

const remember = (response: AuthResponse) => {
  setStoredAccessToken(response.accessToken)
  return response
}

export const login = async (credentials: LoginCredentials): Promise<AuthResponse> => {
  try {
    const { data } = await httpClient.post<AuthResponse>('/users/login', credentials)
    return remember(data)
  } catch (error) {
    throw toApiError(error)
  }
}

export const register = async (details: RegisterDetails): Promise<AuthResponse> => {
  try {
    const { data } = await httpClient.post<AuthResponse>('/users/signup', details)
    return remember(data)
  } catch (error) {
    throw toApiError(error)
  }
}

/** Used on start-up: the cookie is still there even though the token is gone. */
export const refresh = async (): Promise<AuthResponse> => {
  try {
    const { data } = await httpClient.post<AuthResponse>('/users/refresh')
    return remember(data)
  } catch (error) {
    throw toApiError(error)
  }
}

export const logout = async (): Promise<void> => {
  try {
    await httpClient.post('/users/logout')
  } finally {
    // Whatever the server said, this browser is logged out.
    setStoredAccessToken(null)
  }
}
