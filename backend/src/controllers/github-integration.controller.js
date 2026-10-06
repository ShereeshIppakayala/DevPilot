import { randomBytes } from 'node:crypto'
import {
  beginGitHubAuthorization,
  completeGitHubAuthorization,
  disconnectGitHub,
  getPublicGitHubRepository,
  getPublicGitHubRepositoryFile,
  getPublicGitHubRepositoryTree,
  getGitHubRepositoryFile,
  getGitHubRepositoryTree,
  getGitHubConnectionStatus,
  getGitHubFrontendOrigin,
  listGitHubRepositories,
} from '../services/github-integration.service.js'

export async function startGitHubAuthorization(req, res) {
  const result = await beginGitHubAuthorization(req.auth.userId)
  res.status(200).json(result)
}

export async function handleGitHubCallback(req, res) {
  let status = 'error'
  try {
    const result = await completeGitHubAuthorization({
      code: req.query.code,
      state: req.query.state,
      providerError: req.query.error,
    })
    status = result.status
  } catch (error) {
    console.warn(`GitHub authorization callback failed (${error.code ?? error.name}).`)
  }

  const nonce = randomBytes(18).toString('base64url')
  const targetOrigin = JSON.stringify(getGitHubFrontendOrigin())
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`)
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'no-store')
  res.type('html').status(status === 'connected' ? 200 : 400).send(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>GitHub connection</title>
<body><p>GitHub connection ${status === 'connected' ? 'complete' : 'could not be completed'}. You may close this window.</p>
<script nonce="${nonce}">if (window.opener) { window.opener.postMessage({ type: 'devpilot:github-oauth', status: '${status}' }, ${targetOrigin}); window.close(); }</script>
</body></html>`)
}

export async function getGitHubStatus(req, res) {
  const connection = await getGitHubConnectionStatus(req.auth.userId)
  res.status(200).json({ connection })
}

export async function getGitHubRepositories(req, res) {
  const repositories = await listGitHubRepositories(req.auth.userId)
  res.status(200).json({ repositories })
}

export async function getRepositoryTree(req, res) {
  const tree = await getGitHubRepositoryTree(req.auth.userId, req.params.repositoryId)
  res.status(200).json({
    repository: {
      id: tree.repository.id,
      fullName: tree.repository.fullName,
      defaultBranch: tree.repository.defaultBranch,
    },
    entries: tree.entries,
    truncated: tree.truncated,
    commitSha: tree.commitSha,
  })
}

export async function getRepositoryFile(req, res) {
  const file = await getGitHubRepositoryFile(
    req.auth.userId,
    req.params.repositoryId,
    req.query.path,
  )
  res.status(200).json({ file })
}

export async function getPublicRepository(req, res) {
  const repository = await getPublicGitHubRepository(req.params.owner, req.params.repository)
  res.status(200).json({ repository })
}

export async function getPublicRepositoryTree(req, res) {
  const tree = await getPublicGitHubRepositoryTree(req.params.owner, req.params.repository)
  res.status(200).json({
    repository: {
      id: tree.repository.id,
      fullName: tree.repository.fullName,
      defaultBranch: tree.repository.defaultBranch,
    },
    entries: tree.entries,
    truncated: tree.truncated,
    commitSha: tree.commitSha,
  })
}

export async function getPublicRepositoryFile(req, res) {
  const file = await getPublicGitHubRepositoryFile(
    req.params.owner,
    req.params.repository,
    req.query.path,
  )
  res.status(200).json({ file })
}

export async function removeGitHubConnection(req, res) {
  await disconnectGitHub(req.auth.userId)
  res.status(204).end()
}