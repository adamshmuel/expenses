export interface User {
  id: string
  username: string
  email: string
}

export interface AuthResponse {
  user: User
  accessToken: string
}

export interface LoginCredentials {
  username: string
  password: string
}

export interface RegisterDetails {
  username: string
  email: string
  password: string
}

/** What every failed request is turned into, whatever the server sent. */
export interface ApiError {
  message: string
  fieldErrors: Record<string, string>
}
