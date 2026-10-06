import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import {
  disconnectGitHub,
  findPublicGitHubRepository,
  getGitHubConnection,
  listGitHubRepositories,
  startGitHubConnection,
  type GitHubConnection,
  type GitHubRepository,
} from '../../api/github'
import { hasAccessToken } from '../../api/client'
import { RepositoryExplorer } from './RepositoryExplorer'

interface ApiError {
  error?: {
    code?: string
    message?: string
  }
}

interface OAuthMessage {
  type: 'devpilot:github-oauth'
  status: 'connected' | 'denied' | 'error'
}

function responseError(error: unknown) {
  if (axios.isAxiosError<ApiError>(error)) {
    const code = error.response?.data.error?.code
    if (code === 'GITHUB_REAUTH_REQUIRED') return 'GitHub authorization expired or was revoked. Reconnect to continue.'
    if (code === 'GITHUB_RATE_LIMITED') return 'GitHub API rate limit reached. Try again later.'
    return error.response?.data.error?.message ?? 'Could not load GitHub data.'
  }
  if (error instanceof Error) return error.message
  return 'Could not load GitHub data. Check the API connection and try again.'
}

export function GitHubPanel() {
  const [authenticated, setAuthenticated] = useState(hasAccessToken())
  const [connection, setConnection] = useState<GitHubConnection | null>(null)
  const [repositories, setRepositories] = useState<GitHubRepository[]>([])
  const [selectedRepository, setSelectedRepository] = useState<GitHubRepository | null>(null)
  const [publicOwner, setPublicOwner] = useState('')
  const [publicName, setPublicName] = useState('')
  const [isFindingPublicRepository, setIsFindingPublicRepository] = useState(false)
  const [isLoading, setIsLoading] = useState(hasAccessToken())
  const [isConnecting, setIsConnecting] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [error, setError] = useState('')
  const [publicRepositoryError, setPublicRepositoryError] = useState('')
  const [message, setMessage] = useState('')
  const popupRef = useRef<Window | null>(null)

  async function loadConnection() {
    if (!hasAccessToken()) {
      setAuthenticated(false)
      setConnection(null)
      setRepositories([])
      setSelectedRepository(null)
      setIsLoading(false)
      return
    }

    setAuthenticated(true)
    setIsLoading(true)
    setError('')
    let knownConnection: GitHubConnection | null = null
    try {
      const result = await getGitHubConnection()
      knownConnection = result
      setConnection(result)
      if (result.connected) {
        const nextRepositories = await listGitHubRepositories()
        setRepositories(nextRepositories)
        setSelectedRepository((current) => current?.isPublic
          ? current
          : nextRepositories.find((item) => item.id === current?.id) ?? null)
      } else {
        setRepositories([])
        setSelectedRepository(null)
      }
    } catch (requestError) {
      const code = axios.isAxiosError<ApiError>(requestError)
        ? requestError.response?.data.error?.code
        : undefined
      setConnection(code === 'GITHUB_REAUTH_REQUIRED'
        ? { connected: false, status: 'reconnect_required' }
        : knownConnection)
      setRepositories([])
      setSelectedRepository(null)
      setError(responseError(requestError))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    const handleAuthChanged = () => {
      setAuthenticated(hasAccessToken())
      setMessage('')
      void loadConnection()
    }

    const handleOAuthMessage = (event: MessageEvent<OAuthMessage>) => {
      if (event.origin !== window.location.origin || event.source !== popupRef.current) return
      if (event.data?.type !== 'devpilot:github-oauth') return

      popupRef.current = null
      setIsConnecting(false)
      if (event.data.status === 'connected') {
        setMessage('GitHub connected. Accessible repositories are loading.')
        void loadConnection()
      } else {
        setError(event.data.status === 'denied'
          ? 'GitHub authorization was cancelled.'
          : 'GitHub could not be connected. Check the app setup and try again.')
      }
    }

    window.addEventListener('devpilot:auth-changed', handleAuthChanged)
    window.addEventListener('message', handleOAuthMessage)
    void Promise.resolve().then(loadConnection)
    const popupMonitor = window.setInterval(() => {
      if (popupRef.current?.closed) {
        popupRef.current = null
        setIsConnecting(false)
        void loadConnection()
      }
    }, 500)

    return () => {
      window.clearInterval(popupMonitor)
      window.removeEventListener('devpilot:auth-changed', handleAuthChanged)
      window.removeEventListener('message', handleOAuthMessage)
      popupRef.current?.close()
    }
  }, [])

  async function connect() {
    setError('')
    setMessage('')
    const popup = window.open('about:blank', 'devpilot-github-oauth', 'popup,width=620,height=760')
    if (!popup) {
      setError('Allow pop-ups for this site, then try connecting again.')
      return
    }

    popupRef.current = popup
    setIsConnecting(true)
    try {
      const { authorizationUrl } = await startGitHubConnection()
      const target = new URL(authorizationUrl)
      if (target.protocol !== 'https:' || target.hostname !== 'github.com') {
        throw new Error('GitHub returned an unexpected authorization URL')
      }
      popup.location = target.toString()
    } catch (requestError) {
      popup.close()
      popupRef.current = null
      setIsConnecting(false)
      setError(responseError(requestError))
    }
  }

  async function disconnect() {
    setIsDisconnecting(true)
    setError('')
    setMessage('')
    try {
      await disconnectGitHub()
      setConnection({ connected: false })
      setRepositories([])
      setSelectedRepository((current) => current?.isPublic ? current : null)
      setMessage('GitHub was disconnected from DevPilot.')
    } catch (requestError) {
      setError(responseError(requestError))
    } finally {
      setIsDisconnecting(false)
    }
  }

  async function lookupPublicRepository(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsFindingPublicRepository(true)
    setPublicRepositoryError('')
    setMessage('')
    try {
      const repository = await findPublicGitHubRepository(publicOwner.trim(), publicName.trim())
      setSelectedRepository(repository)
      setMessage(`Public repository ${repository.fullName} is ready to explore.`)
    } catch (requestError) {
      setPublicRepositoryError(responseError(requestError))
    } finally {
      setIsFindingPublicRepository(false)
    }
  }

  const requiresReconnect = connection?.status === 'reconnect_required'

  return (
    <section className="github-panel" aria-labelledby="github-title">
      <div className="github-panel-heading">
        <div>
          <div className="eyebrow">SOURCE CONTROL</div>
          <h2 id="github-title">GitHub repositories</h2>
        </div>
        <span className={`github-state ${connection?.connected ? 'github-state-on' : ''}`}>
          <span aria-hidden="true" />
          {isLoading ? 'CHECKING' : connection?.connected ? 'CONNECTED' : requiresReconnect ? 'RECONNECT' : 'NOT CONNECTED'}
        </span>
      </div>

      {!authenticated ? (
        <div className="github-empty">Sign in to connect a GitHub account.</div>
      ) : isLoading ? (
        <div className="github-loading" role="status">Checking GitHub connection…</div>
      ) : connection?.connected ? (
        <>
          <div className="github-account-row">
            <span>Connected as <strong>@{connection.githubLogin}</strong></span>
            <button className="github-text-button" type="button" disabled={isDisconnecting} onClick={() => void disconnect()}>
              {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
          {error ? (
            <div className="github-error-block" role="alert">
              <p>{error}</p>
              <button className="github-text-button" type="button" onClick={() => void loadConnection()}>Retry</button>
            </div>
          ) : repositories.length ? (
            <ul className="repository-list" aria-label="Accessible GitHub repositories">
              {repositories.map((repository) => (
                <li key={repository.id}>
                  <span className="repository-icon" aria-hidden="true">{repository.private ? 'P' : 'R'}</span>
                  <button
                    className={`repository-select ${!selectedRepository?.isPublic && selectedRepository?.id === repository.id ? 'repository-select-active' : ''}`}
                    type="button"
                    onClick={() => setSelectedRepository(repository)}
                    aria-pressed={!selectedRepository?.isPublic && selectedRepository?.id === repository.id}
                  >
                    <span className="repository-copy">
                      <strong>{repository.fullName}</strong>
                      <small>{repository.defaultBranch || 'No default branch'}</small>
                    </span>
                  </button>
                  <span className="repository-visibility">{repository.private ? 'PRIVATE' : 'PUBLIC'}</span>
                  <a className="repository-open" href={repository.url} target="_blank" rel="noreferrer" aria-label={`Open ${repository.fullName} on GitHub`} title="Open on GitHub">↗</a>
                </li>
              ))}
            </ul>
          ) : (
            <div className="github-empty">
              <p>No repositories are available to this GitHub App installation yet.</p>
              {connection.installationUrl && (
                <a className="github-install-link" href={connection.installationUrl} target="_blank" rel="noreferrer">
                  Install the app or choose repositories <span aria-hidden="true">↗</span>
                </a>
              )}
            </div>
          )}
          <button className="github-refresh-button" type="button" onClick={() => void loadConnection()}>Refresh repositories</button>
        </>
      ) : (
        <div className="github-connect-area">
          <p>{requiresReconnect
            ? 'GitHub authorization expired or was revoked. Reconnect to refresh repository access.'
            : 'Connect GitHub to see repositories covered by your app installation.'}</p>
          <button className="github-connect-button" type="button" disabled={isConnecting} onClick={() => void connect()}>
            {isConnecting ? 'Opening GitHub…' : requiresReconnect ? 'Reconnect GitHub' : 'Connect GitHub'}
          </button>
        </div>
      )}

      {authenticated && !isLoading && (
        <form className="public-repository-form" onSubmit={(event) => void lookupPublicRepository(event)}>
          <div className="public-repository-heading">
            <div>
              <span className="eyebrow">EXPLORE BEYOND YOUR INSTALLATION</span>
              <p>Open any public GitHub repository by owner and name.</p>
            </div>
            <span className="public-badge">PUBLIC</span>
          </div>
          <div className="public-repository-fields">
            <label>
              <span>Owner</span>
              <input
                autoComplete="off"
                maxLength={39}
                placeholder="facebook"
                required
                value={publicOwner}
                onChange={(event) => setPublicOwner(event.target.value)}
              />
            </label>
            <span className="public-path-separator" aria-hidden="true">/</span>
            <label>
              <span>Repository</span>
              <input
                autoComplete="off"
                maxLength={100}
                placeholder="react"
                required
                value={publicName}
                onChange={(event) => setPublicName(event.target.value)}
              />
            </label>
            <button className="public-repository-button" type="submit" disabled={isFindingPublicRepository}>
              {isFindingPublicRepository ? 'Looking up…' : 'Explore'}
            </button>
          </div>
          <small>Public source files are sent to the configured AI provider only when you request analysis.</small>
        </form>
      )}

      <div className="github-feedback" aria-live="polite">
        {error && !connection?.connected && <p className="github-error" role="alert">{error}</p>}
        {publicRepositoryError && <p className="github-error" role="alert">{publicRepositoryError}</p>}
        {message && <p>{message}</p>}
      </div>
      {authenticated && selectedRepository && (
        <RepositoryExplorer repository={selectedRepository} onClose={() => setSelectedRepository(null)} />
      )}
    </section>
  )
}