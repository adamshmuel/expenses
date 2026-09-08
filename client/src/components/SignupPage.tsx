import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { clearErrors, register } from '../store/authSlice'
import { FormField } from './FormField'
import { AlertIcon } from './icons'
import { LedgerSlip } from './LedgerSlip'

export const SignupPage = () => {
  const dispatch = useAppDispatch()
  const { status, error, fieldErrors } = useAppSelector((state) => state.auth)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  // The only check we make in the browser: the server never sees the second
  // password, so it cannot compare them for us.
  const [mismatch, setMismatch] = useState<string | undefined>(undefined)

  useEffect(() => {
    dispatch(clearErrors())
  }, [dispatch])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()

    if (password !== confirmPassword) {
      setMismatch('The passwords do not match.')
      return
    }

    setMismatch(undefined)
    dispatch(register({ username, email, password }))
  }

  const isSending = status === 'loading'

  return (
    <main className="auth-page">
      <LedgerSlip />

      <div className="auth-page__inner">
        <div className="auth-page__intro">
          <h1>Create your account</h1>
          <p>You start with a set of categories you can rename or replace.</p>
        </div>

        <form className="card" onSubmit={handleSubmit} noValidate>
          {error && (
            <div className="banner banner--error" role="alert">
              <AlertIcon />
              <span>{error}</span>
            </div>
          )}

          <FormField
            id="signup-username"
            label="Username"
            type="text"
            autoComplete="username"
            value={username}
            error={fieldErrors.username}
            onChange={(event) => setUsername(event.target.value)}
          />

          <FormField
            id="signup-email"
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            error={fieldErrors.email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <FormField
            id="signup-password"
            label="Password"
            type="password"
            autoComplete="new-password"
            value={password}
            error={fieldErrors.password}
            hint="At least 8 characters."
            onChange={(event) => setPassword(event.target.value)}
          />

          <FormField
            id="signup-confirm"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            error={mismatch}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />

          <button type="submit" className="button button--primary" disabled={isSending}>
            {isSending ? 'Creating your account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-page__footer">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </main>
  )
}
