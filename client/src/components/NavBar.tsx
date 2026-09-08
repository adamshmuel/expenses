import { NavLink, useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { logout } from '../store/authSlice'
import { Mark } from './icons'

export const NavBar = () => {
  const user = useAppSelector((state) => state.auth.user)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await dispatch(logout())
    navigate('/login')
  }

  return (
    <header className="navbar">
      <div className="navbar__left">
        <div className="brand">
          <Mark />
          <span className="brand__name">Expenses</span>
        </div>

        {user && (
          <nav className="navbar__links">
            <NavLink to="/home">Home</NavLink>
            <NavLink to="/dashboard">Dashboard</NavLink>
          </nav>
        )}
      </div>

      {user ? (
        <div className="navbar__right">
          <div className="navbar__user">
            <span className="avatar" aria-hidden="true">
              {user.username.charAt(0).toUpperCase()}
            </span>
            <span>{user.username}</span>
          </div>
          <button type="button" className="button button--plain" onClick={handleLogout}>
            Log out
          </button>
        </div>
      ) : (
        <div className="navbar__right">
          <NavLink to="/login" className="navbar__quiet-link">
            Log in
          </NavLink>
          <NavLink to="/signup" className="button button--primary button--small">
            Sign up
          </NavLink>
        </div>
      )}
    </header>
  )
}
