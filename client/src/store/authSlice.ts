import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import * as authApi from '../api/authApi'
import type { ApiError, AuthResponse, LoginCredentials, RegisterDetails, User } from '../api/types'

interface AuthState {
  user: User | null
  accessToken: string | null
  /** 'checking' is only used once, while the app asks whether a session exists. */
  status: 'idle' | 'checking' | 'loading' | 'succeeded' | 'failed'
  error: string | null
  fieldErrors: Record<string, string>
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
  status: 'idle',
  error: null,
  fieldErrors: {},
}

// rejectWithValue lets the failure travel as our own ApiError shape instead of
// a stringified Error, so the screens can show messages under the right field.
export const login = createAsyncThunk<AuthResponse, LoginCredentials, { rejectValue: ApiError }>(
  'auth/login',
  async (credentials, { rejectWithValue }) => {
    try {
      return await authApi.login(credentials)
    } catch (error) {
      return rejectWithValue(error as ApiError)
    }
  },
)

export const register = createAsyncThunk<AuthResponse, RegisterDetails, { rejectValue: ApiError }>(
  'auth/register',
  async (details, { rejectWithValue }) => {
    try {
      return await authApi.register(details)
    } catch (error) {
      return rejectWithValue(error as ApiError)
    }
  },
)

/** Runs once when the app starts, to see whether the refresh cookie is still valid. */
export const restoreSession = createAsyncThunk<AuthResponse, void, { rejectValue: ApiError }>(
  'auth/restoreSession',
  async (_, { rejectWithValue }) => {
    try {
      return await authApi.refresh()
    } catch (error) {
      return rejectWithValue(error as ApiError)
    }
  },
)

export const logout = createAsyncThunk('auth/logout', async () => {
  await authApi.logout()
})

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    /** Called after the http layer silently refreshed an expired token. */
    setAccessToken(state, action: PayloadAction<string | null>) {
      state.accessToken = action.payload
    },
    clearErrors(state) {
      state.error = null
      state.fieldErrors = {}
    },
    sessionExpired(state) {
      state.user = null
      state.accessToken = null
      state.status = 'idle'
    },
  },
  extraReducers: (builder) => {
    const succeeded = (state: AuthState, action: PayloadAction<AuthResponse>) => {
      state.user = action.payload.user
      state.accessToken = action.payload.accessToken
      state.status = 'succeeded'
      state.error = null
      state.fieldErrors = {}
    }

    const failed = (state: AuthState, action: { payload?: ApiError }) => {
      state.status = 'failed'
      state.error = action.payload?.message ?? 'Something went wrong.'
      state.fieldErrors = action.payload?.fieldErrors ?? {}
    }

    builder
      .addCase(login.pending, (state) => {
        state.status = 'loading'
        state.error = null
        state.fieldErrors = {}
      })
      .addCase(login.fulfilled, succeeded)
      .addCase(login.rejected, failed)

      .addCase(register.pending, (state) => {
        state.status = 'loading'
        state.error = null
        state.fieldErrors = {}
      })
      .addCase(register.fulfilled, succeeded)
      .addCase(register.rejected, failed)

      // Restoring is silent: no session simply means "show the login screen",
      // which is not an error worth putting on the page.
      .addCase(restoreSession.pending, (state) => {
        state.status = 'checking'
      })
      .addCase(restoreSession.fulfilled, succeeded)
      .addCase(restoreSession.rejected, (state) => {
        state.user = null
        state.accessToken = null
        state.status = 'idle'
      })

      .addCase(logout.fulfilled, (state) => {
        state.user = null
        state.accessToken = null
        state.status = 'idle'
        state.error = null
        state.fieldErrors = {}
      })
  },
})

export const { setAccessToken, clearErrors, sessionExpired } = authSlice.actions
export default authSlice.reducer
