import { useState, type FormEvent } from 'react'
import axios from 'axios'
import { getCurrentUser, loginAccount, registerAccount, type PublicUser } from '../../api/auth'
import { clearAccessToken, setAccessToken } from '../../api/client'

type AuthMode = 'login' | 'register'

interface ApiError {
  error?: {
    message?: string
  }
}

interface AuthPanelProps {
  onUserChange: (user: PublicUser | null) => void
}

function getErrorMessage(error: unknown) {
  if (axios.isAxiosError<ApiError>(error)) {
    return error.response?.data.error?.message ?? 'The API could not complete the request.'
  }
  return 'The API could not complete the request.'
}

export function AuthPanel({ onUserChange }: AuthPanelProps) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [user, setUser] = useState<PublicUser | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    setError('')
    setIsSubmitting(true)

    try {
      if (mode === 'register') {
        await registerAccount({ email, password, displayName })
        setPassword('')
        setMode('login')
        setMessage('Account created. Sign in to verify your account access.')
        return
      }

      const result = await loginAccount({ email, password })
      setAccessToken(result.accessToken)
      const profile = await getCurrentUser()
      setUser(profile.user)
      onUserChange(profile.user)
      setPassword('')
    } catch (requestError) {
      clearAccessToken()
      setUser(null)
      onUserChange(null)
      setError(getErrorMessage(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  function logout() {
    clearAccessToken()
    setUser(null)
    onUserChange(null)
    setMessage('Signed out. The in-memory access token was cleared.')
    setError('')
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode)
    setMessage('')
    setError('')
  }

  return (
    <section className="auth-panel" aria-labelledby="auth-title">
      <div className="auth-panel-heading">
        <div>
          <div className="eyebrow">ACCOUNT ACCESS</div>
          <h2 id="auth-title">{user ? 'Signed in' : 'Your workspace'}</h2>
        </div>
        <span className={`auth-state ${user ? 'auth-state-on' : ''}`}>
          <span aria-hidden="true" />{user ? 'ACTIVE' : 'LOCKED'}
        </span>
      </div>

      {user ? (
        <div className="profile-state">
          <div className="profile-avatar" aria-hidden="true">
            {(user.displayName || user.email).slice(0, 1).toUpperCase()}
          </div>
          <div className="profile-copy">
            <strong>{user.displayName || user.email}</strong>
            <span>{user.email}</span>
            <small>Protected endpoint verified</small>
          </div>
          <button className="auth-secondary-button" type="button" onClick={logout}>Clear token</button>
        </div>
      ) : (
        <>
          <div className="auth-mode-switch" aria-label="Account action">
            <button type="button" aria-pressed={mode === 'login'} onClick={() => changeMode('login')}>Sign in</button>
            <button type="button" aria-pressed={mode === 'register'} onClick={() => changeMode('register')}>Create account</button>
          </div>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            {mode === 'register' && (
              <label>
                <span>Display name</span>
                <input autoComplete="name" maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </label>
            )}
            <label>
              <span>Email</span>
              <input
                autoComplete="email"
                type="email"
                maxLength={254}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              <span>Password</span>
              <input
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                type="password"
                minLength={mode === 'register' ? 12 : undefined}
                maxLength={72}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button className="auth-primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Working…' : mode === 'register' ? 'Create account' : 'Sign in'}
            </button>
          </form>
        </>
      )}

      <div className="auth-feedback" aria-live="polite">
        {error && <p className="auth-error" role="alert">{error}</p>}
        {message && <p className="auth-message">{message}</p>}
      </div>
    </section>
  )
}