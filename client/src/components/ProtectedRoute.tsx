import type { ReactElement } from 'react'
import { Navigate } from 'react-router-dom'
import { useAppSelector } from '../store/hooks'

/**
 * Wraps a page that only makes sense for a logged-in user.
 *
 * While the app is still asking the server whether a session exists we render
 * nothing — sending the user to /login at that moment would bounce them off a
 * page they are actually allowed to see.
 */
export const ProtectedRoute = ({ children }: { children: ReactElement }) => {
  const { user, status } = useAppSelector((state) => state.auth)

  if (status === 'checking') return null
  if (!user) return <Navigate to="/login" replace />
  return children
}

/** The mirror image: /login and /signup are pointless once you are logged in. */
export const PublicOnlyRoute = ({ children }: { children: ReactElement }) => {
  const { user, status } = useAppSelector((state) => state.auth)

  if (status === 'checking') return null
  if (user) return <Navigate to="/home" replace />
  return children
}
