import axios, { AxiosError } from 'axios'
import { getAccessToken, setStoredAccessToken } from './tokenStore'
import type { ApiError } from './types'

const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export const httpClient = axios.create({
  baseURL,
  // Sends and receives the refresh-token cookie. The server must allow
  // credentials for this origin in its CORS settings.
  withCredentials: true,
})

// Every request carries the access token, when we have one.
httpClient.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/** Called when a refresh fails, so the app can send the user back to /login. */
let onSessionExpired: () => void = () => {}
export const setOnSessionExpired = (handler: () => void) => {
  onSessionExpired = handler
}

// A 401 means the access token expired. Ask for a new one **once**, then retry
// the original request. If the refresh also fails, the session is over.
httpClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const request = error.config as (typeof error.config & { _retried?: boolean }) | undefined
    const isRefreshCall = request?.url?.includes('/users/refresh')

    if (error.response?.status === 401 && request && !request._retried && !isRefreshCall) {
      request._retried = true
      try {
        const { data } = await httpClient.post('/users/refresh')
        setStoredAccessToken(data.accessToken)
        return httpClient(request)
      } catch {
        setStoredAccessToken(null)
        onSessionExpired()
      }
    }
    return Promise.reject(error)
  },
)

/**
 * Turns anything the server (or the network) throws at us into one shape the
 * screens can rely on.
 *
 * The server is expected to answer failures with either
 *   { error: "a sentence" }
 * or, for validation,
 *   { errors: [{ field: "email", message: "Already registered." }] }
 */
export const toApiError = (error: unknown): ApiError => {
  if (!axios.isAxiosError(error)) {
    return { message: 'Something went wrong.', fieldErrors: {} }
  }
  if (!error.response) {
    return { message: 'Cannot reach the server. Check that it is running.', fieldErrors: {} }
  }

  const data = error.response.data as
    | { error?: string; errors?: { field: string; message: string }[] }
    | undefined

  const fieldErrors: Record<string, string> = {}
  for (const item of data?.errors ?? []) {
    // Keep the first message per field — showing three under one input is noise.
    if (!fieldErrors[item.field]) fieldErrors[item.field] = item.message
  }

  const message =
    data?.error ??
    (Object.keys(fieldErrors).length > 0
      ? 'Please fix the highlighted fields.'
      : 'Something went wrong.')

  return { message, fieldErrors }
}
