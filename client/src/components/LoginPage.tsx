import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { clearErrors, login } from '../store/authSlice'
import { FormField } from './FormField'
import { AlertIcon } from './icons'
import { LedgerSlip } from './LedgerSlip'

export const LoginPage = () => {
  const dispatch = useAppDispatch()
  const { status, error, fieldErrors } = useAppSelector((state) => state.auth)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  // A message from a previous attempt should not greet the user on arrival.
  useEffect(() => {
    dispatch(clearErrors())
  }, [dispatch])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    dispatch(login({ username, password }))
  }

  const isSending = status === 'loading'

  return (
    <main className="auth-page">
      <LedgerSlip />

      <div className="auth-page__inner">
        <div className="auth-page__intro">
          <h1>Log in</h1>
        </div>

        <form className="card" onSubmit={handleSubmit} noValidate>
          {error && (
            <div className="banner banner--error" role="alert">
              <AlertIcon />
              <span>{error}</span>
            </div>
          )}

          <FormField
            id="username"
            label="Username"
            type="text"
            autoComplete="username"
            value={username}
            error={fieldErrors.username}
            onChange={(event) => setUsername(event.target.value)}
          />

          <FormField
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            error={fieldErrors.password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <button type="submit" className="button button--primary" disabled={isSending}>
            {isSending ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p className="auth-page__footer">
          No account yet? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </main>
  )
}
