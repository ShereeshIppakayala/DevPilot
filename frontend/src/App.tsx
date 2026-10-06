import { useEffect, useState } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { getHealth, type HealthResponse } from './api/health'
import type { PublicUser } from './api/auth'
import { AuthPanel } from './features/auth/AuthPanel'
import { GitHubPanel } from './features/github/GitHubPanel'
import './workspace.css'

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null)
  const [error, setError] = useState('')
  const [isChecking, setIsChecking] = useState(true)

  async function checkHealth() {
    setIsChecking(true)
    setError('')

    try {
      setHealth(await getHealth())
    } catch {
      setHealth(null)
      setError('The API is not responding. Start the backend and try again.')
    } finally {
      setIsChecking(false)
    }
  }

  useEffect(() => {
    let isActive = true

    getHealth()
      .then((result) => {
        if (isActive) setHealth(result)
      })
      .catch(() => {
        if (isActive) {
          setHealth(null)
          setError('The API is not responding. Start the backend and try again.')
        }
      })
      .finally(() => {
        if (isActive) setIsChecking(false)
      })

    return () => {
      isActive = false
    }
  }, [])

  return (
    <Routes>
      <Route
        path="/"
        element={
          <main className="workspace-shell">
            <aside className="sidebar">
              <Link className="brand" to="/" aria-label="DevPilot home">
                <span className="brand-mark" aria-hidden="true">D</span>
                <span>DevPilot</span>
              </Link>
              <div className="sidebar-label">WORKSPACE</div>
              <div className="nav-item nav-item-active">
                <span className="nav-indicator" aria-hidden="true" />
                Overview
              </div>
              <div className="sidebar-footer">
                <span className="avatar">
                  {(currentUser?.displayName || currentUser?.email || 'Guest').slice(0, 1).toUpperCase()}
                </span>
                <span className="sidebar-footer-copy">
                  <strong>{currentUser?.displayName || currentUser?.email || 'Guest'}</strong>
                  <small>{currentUser ? 'Signed in' : 'Local workspace'}</small>
                </span>
                <span className="local-indicator" title="Running locally" />
              </div>
            </aside>

            <section className="main-panel">
              <header className="topbar">
                <span>Workspace / Overview</span>
                <span className="environment-label">DEVELOPMENT</span>
              </header>

              <div className="page-content">
                <div className="intro">
                  <div className="intro-copy-block">
                    <div className="eyebrow">SOFTWARE ENGINEERING, WITH CONTEXT</div>
                    <h1>Your code, understood.</h1>
                    <p className="intro-copy">
                      A focused workspace for exploring repositories and reasoning about the systems inside them.
                    </p>
                    <div className="intro-tags" aria-label="Workspace features">
                      <span><i aria-hidden="true" /> LOCAL-FIRST</span>
                      <span>REPOSITORY INTELLIGENCE</span>
                    </div>
                  </div>
                  <aside className="intro-note" aria-label="Workspace purpose">
                    <span className="intro-note-mark" aria-hidden="true">DP</span>
                    <div className="eyebrow">A WORKSPACE FOR BUILDERS</div>
                    <p>Move from unfamiliar code to a clearer understanding, one repository at a time.</p>
                    <span className="intro-note-foot">PRIVATE BY DEFAULT <span aria-hidden="true">↗</span></span>
                  </aside>
                </div>

                <section className="readiness-panel" aria-labelledby="readiness-title">
                  <div className="readiness-copy">
                    <div className="readiness-icon" aria-hidden="true">01</div>
                    <div>
                      <div className="eyebrow">FOUNDATION</div>
                      <h2 id="readiness-title">Workspace services</h2>
                      <p>Frontend and API are separated and ready for the next build step.</p>
                    </div>
                  </div>
                  <div className="service-row" aria-live="polite">
                    <span className={`status-dot ${health ? 'status-online' : error ? 'status-offline' : ''}`} />
                    <span className="service-name">REST API</span>
                    <span className="service-status">
                      {isChecking ? 'Checking' : health ? 'Online' : 'Unavailable'}
                    </span>
                    {error && (
                      <button className="retry-button" type="button" onClick={() => void checkHealth()}>
                        Retry
                      </button>
                    )}
                  </div>
                  {error && <p className="service-error" role="alert">{error}</p>}
                </section>

                <section className="workflow-section" aria-labelledby="workflow-title">
                  <div className="workflow-heading">
                    <div>
                      <div className="eyebrow">YOUR WORKFLOW</div>
                      <h2 id="workflow-title">From repository to answers</h2>
                    </div>
                    <span>THREE SIMPLE STEPS</span>
                  </div>
                  <div className="workflow-steps">
                    <article className="workflow-step">
                      <span className="workflow-number">01</span>
                      <div>
                        <h3>Connect</h3>
                        <p>Link GitHub to bring a repository into your workspace.</p>
                      </div>
                      <span className="workflow-arrow" aria-hidden="true">↗</span>
                    </article>
                    <article className="workflow-step">
                      <span className="workflow-number">02</span>
                      <div>
                        <h3>Explore</h3>
                        <p>Browse files and focus on the code that matters.</p>
                      </div>
                      <span className="workflow-arrow" aria-hidden="true">↗</span>
                    </article>
                    <article className="workflow-step">
                      <span className="workflow-number">03</span>
                      <div>
                        <h3>Understand</h3>
                        <p>Ask questions and follow answers back to their sources.</p>
                      </div>
                      <span className="workflow-arrow" aria-hidden="true">↗</span>
                    </article>
                  </div>
                </section>

                <div className="lower-grid">
                  <AuthPanel onUserChange={setCurrentUser} />

                  <GitHubPanel />
                </div>
                <footer className="page-footer">DEVPILOT <span>·</span> STAGE 08 / REPOSITORY RAG</footer>
              </div>
            </section>
          </main>
        }
      />
      <Route path="*" element={<main className="not-found"><h1>Page not found</h1><Link to="/">Return to workspace</Link></main>} />
    </Routes>
  )
}

export default App
