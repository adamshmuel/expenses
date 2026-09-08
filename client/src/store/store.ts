import { configureStore } from '@reduxjs/toolkit'
import authReducer from './authSlice'

/** A fresh store. The app makes one; each test makes its own. */
export const makeStore = () =>
  configureStore({
    reducer: {
      auth: authReducer,
    },
  })

export const store = makeStore()

export type AppStore = ReturnType<typeof makeStore>
export type RootState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']
