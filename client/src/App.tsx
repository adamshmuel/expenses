import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAppDispatch } from './store/hooks'
import { restoreSession, sessionExpired } from './store/authSlice'
import { setOnSessionExpired } from './api/httpClient'
import { NavBar } from './components/NavBar'
import { ProtectedRoute, PublicOnlyRoute } from './components/ProtectedRoute'
import { LoginPage } from './components/LoginPage'
import { SignupPage } from './components/SignupPage'
import { HomePage } from './components/HomePage'
import { DashboardPage } from './components/DashboardPage'
import { PageNotFound } from './components/PageNotFound'

const App = () => {
  const dispatch = useAppDispatch()

  useEffect(() => {
    // The access token is gone after a reload, but the refresh cookie may still
    // be valid — ask once, before deciding the user is logged out.
    dispatch(restoreSession())

    // If the http layer ever fails to refresh mid-session, clear the user so
    // the protected routes send them back to /login.
    setOnSessionExpired(() => dispatch(sessionExpired()))
  }, [dispatch])

  return (
    <div className="app">
      <NavBar />
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <LoginPage />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/signup"
          element={
            <PublicOnlyRoute>
              <SignupPage />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <HomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </div>
  )
}

export default App
