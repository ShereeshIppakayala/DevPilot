import { createHash, randomBytes } from 'node:crypto'
import { config } from '../config/env.js'
import { GitHubConnection } from '../models/github-connection.model.js'
import { GitHubOAuthState } from '../models/github-oauth-state.model.js'
import { RagChunk } from '../models/rag-chunk.model.js'
import { RagIndex } from '../models/rag-index.model.js'
import { User } from '../models/user.model.js'
import {
  exchangeAuthorizationCode,
  getRepositoryTextFile,
  getRepositoryTree,
  getGitHubUser,
  GitHubApiError,
  getPublicRepository,
  listAccessibleRepositories,
  refreshUserAccessToken,
} from '../providers/github/github-api.js'
import { decryptGitHubToken, encryptGitHubToken } from './github-token-crypto.js'
import { HttpError } from '../utils/http-error.js'

const stateLifetimeMs = 10 * 60 * 1000
const tokenRefreshBufferMs = 2 * 60 * 1000

function getValidatedFrontendUrl() {
  let frontendUrl
  try {
    frontendUrl = new URL(config.frontendUrl)
  } catch {
    throw new HttpError(503, 'GITHUB_NOT_CONFIGURED', 'GitHub integration is not configured')
  }

  const localHttpAllowed = config.environment === 'development'
    && ['localhost', '127.0.0.1', '[::1]'].includes(frontendUrl.hostname)
  if (frontendUrl.protocol !== 'https:' && !(frontendUrl.protocol === 'http:' && localHttpAllowed)) {
    throw new HttpError(503, 'GITHUB_NOT_CONFIGURED', 'GitHub integration is not configured')
  }
  return frontendUrl
}

function getGitHubConfiguration() {
  if (!config.githubAppClientId || !config.githubAppClientSecret || !config.githubAppCallbackUrl) {
    throw new HttpError(503, 'GITHUB_NOT_CONFIGURED', 'GitHub integration is not configured')
  }
  try {
    const callbackUrl = new URL(config.githubAppCallbackUrl)
    const frontendUrl = getValidatedFrontendUrl()
    const localHosts = ['localhost', '127.0.0.1', '[::1]']
    const callbackHttpAllowed = config.environment === 'development'
      && localHosts.includes(callbackUrl.hostname)
    const frontendHttpAllowed = config.environment === 'development'
      && localHosts.includes(frontendUrl.hostname)
    if (callbackUrl.protocol !== 'https:' && !(callbackUrl.protocol === 'http:' && callbackHttpAllowed)) {
      throw new Error('GitHub callback must use HTTPS outside local development')
    }
    if (frontendUrl.protocol !== 'https:' && !(frontendUrl.protocol === 'http:' && frontendHttpAllowed)) {
      throw new Error('Frontend URL must use HTTP or HTTPS')
    }
  } catch {
    throw new HttpError(503, 'GITHUB_NOT_CONFIGURED', 'GitHub integration is not configured')
  }
  try {
    encryptGitHubToken('configuration-check')
  } catch {
    throw new HttpError(503, 'GITHUB_NOT_CONFIGURED', 'GitHub integration is not configured')
  }

  return {
    clientId: config.githubAppClientId,
    clientSecret: config.githubAppClientSecret,
    callbackUrl: config.githubAppCallbackUrl,
  }
}

function hashState(state) {
  return createHash('sha256').update(state).digest('hex')
}

function tokenExpiry(payload, key) {
  const seconds = Number(payload[key])
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(Date.now() + seconds * 1000)
    : null
}

export async function beginGitHubAuthorization(userId) {
  const githubConfig = getGitHubConfiguration()
  const state = randomBytes(32).toString('base64url')
  await GitHubOAuthState.create({
    stateHash: hashState(state),
    userId,
    expiresAt: new Date(Date.now() + stateLifetimeMs),
  })

  const authorizeUrl = new URL('https://github.com/login/oauth/authorize')
  authorizeUrl.searchParams.set('client_id', githubConfig.clientId)
  authorizeUrl.searchParams.set('redirect_uri', githubConfig.callbackUrl)
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('allow_signup', 'false')

  return { authorizationUrl: authorizeUrl.toString() }
}

async function consumeOAuthState(state) {
  if (typeof state !== 'string' || state.length < 32 || state.length > 128) {
    throw new HttpError(400, 'GITHUB_STATE_INVALID', 'GitHub authorization could not be verified')
  }

  const stateRecord = await GitHubOAuthState.findOneAndDelete({
    stateHash: hashState(state),
    expiresAt: { $gt: new Date() },
  })
  if (!stateRecord) {
    throw new HttpError(400, 'GITHUB_STATE_INVALID', 'GitHub authorization could not be verified')
  }
  return stateRecord.userId
}

export async function completeGitHubAuthorization({ code, state, providerError }) {
  const userId = await consumeOAuthState(state)
  if (providerError) return { status: 'denied' }
  if (typeof code !== 'string' || code.length > 2048) {
    return { status: 'error' }
  }

  const user = await User.findById(userId).select('_id status')
  if (!user || user.status !== 'active') {
    return { status: 'error' }
  }

  const githubConfig = getGitHubConfiguration()
  const tokens = await exchangeAuthorizationCode({ ...githubConfig, code })
  const githubUser = await getGitHubUser(tokens.access_token)
  if (!Number.isSafeInteger(githubUser.id) || typeof githubUser.login !== 'string') {
    throw new HttpError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub returned an invalid account response')
  }

  await GitHubConnection.findOneAndUpdate(
    { userId },
    {
      $set: {
        githubUserId: githubUser.id,
        githubLogin: githubUser.login,
        accessToken: encryptGitHubToken(tokens.access_token),
        refreshToken: tokens.refresh_token ? encryptGitHubToken(tokens.refresh_token) : undefined,
        accessTokenExpiresAt: tokenExpiry(tokens, 'expires_in'),
        refreshTokenExpiresAt: tokenExpiry(tokens, 'refresh_token_expires_in'),
        status: 'connected',
        connectedAt: new Date(),
      },
      $unset: tokens.refresh_token ? {} : { refreshToken: 1 },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  )

  return { status: 'connected' }
}

export async function getGitHubConnectionStatus(userId) {
  const connection = await GitHubConnection.findOne({ userId })
    .select('githubLogin status connectedAt')
    .lean()
  if (!connection) return { connected: false }

  return {
    connected: connection.status === 'connected',
    status: connection.status,
    githubLogin: connection.githubLogin,
    connectedAt: connection.connectedAt,
    installationUrl: config.githubAppSlug && /^[a-z\d-]+$/i.test(config.githubAppSlug)
      ? `https://github.com/apps/${config.githubAppSlug}/installations/new`
      : undefined,
  }
}

async function markReconnectRequired(connection) {
  connection.status = 'reconnect_required'
  await connection.save()
  throw new HttpError(409, 'GITHUB_REAUTH_REQUIRED', 'Reconnect your GitHub account to continue')
}

async function mapRepositoryReadError(error, connection, fallbackMessage) {
  if (error instanceof GitHubApiError && error.status === 401) {
    await markReconnectRequired(connection)
  }
  if (error instanceof GitHubApiError && error.remainingRateLimit === '0') {
    throw new HttpError(503, 'GITHUB_RATE_LIMITED', 'GitHub API rate limit reached. Try again later.')
  }
  if (error instanceof GitHubApiError && error.status === 403) {
    throw new HttpError(403, 'GITHUB_ACCESS_DENIED', 'GitHub did not grant permission to read this repository')
  }
  if (error.name === 'GitHubNetworkError') {
    throw new HttpError(502, 'GITHUB_UNAVAILABLE', 'GitHub could not be reached. Try again later.')
  }
  if (error instanceof GitHubApiError && error.status === 404) {
    throw new HttpError(404, 'GITHUB_RESOURCE_NOT_FOUND', 'The repository resource is no longer available')
  }
  if (error instanceof GitHubApiError) {
    throw new HttpError(502, 'GITHUB_UNAVAILABLE', fallbackMessage)
  }
  throw error
}

async function getValidAccessToken(connection) {
  const accessExpiry = connection.accessTokenExpiresAt?.getTime()
  if (!accessExpiry || accessExpiry - Date.now() > tokenRefreshBufferMs) {
    return decryptGitHubToken(connection.accessToken)
  }

  if (!connection.refreshToken || (connection.refreshTokenExpiresAt && connection.refreshTokenExpiresAt <= new Date())) {
    await markReconnectRequired(connection)
  }

  let refreshed
  try {
    refreshed = await refreshUserAccessToken({
      refreshToken: decryptGitHubToken(connection.refreshToken),
      clientId: config.githubAppClientId,
      clientSecret: config.githubAppClientSecret,
    })
  } catch (error) {
    if (error.name === 'GitHubRefreshError') await markReconnectRequired(connection)
    throw new HttpError(502, 'GITHUB_UNAVAILABLE', 'GitHub token refresh is temporarily unavailable')
  }

  connection.accessToken = encryptGitHubToken(refreshed.access_token)
  connection.refreshToken = refreshed.refresh_token
    ? encryptGitHubToken(refreshed.refresh_token)
    : connection.refreshToken
  connection.accessTokenExpiresAt = tokenExpiry(refreshed, 'expires_in')
  connection.refreshTokenExpiresAt = tokenExpiry(refreshed, 'refresh_token_expires_in')
  await connection.save()
  return refreshed.access_token
}

export async function listGitHubRepositories(userId) {
  const connection = await GitHubConnection.findOne({ userId })
    .select('+accessToken +refreshToken')
  if (!connection) {
    throw new HttpError(404, 'GITHUB_NOT_CONNECTED', 'Connect a GitHub account first')
  }
  if (connection.status !== 'connected') {
    throw new HttpError(409, 'GITHUB_REAUTH_REQUIRED', 'Reconnect your GitHub account to continue')
  }

  const accessToken = await getValidAccessToken(connection)
  try {
    return await listAccessibleRepositories(accessToken)
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 401) {
      await markReconnectRequired(connection)
    }
    if (error instanceof GitHubApiError && error.remainingRateLimit === '0') {
      throw new HttpError(503, 'GITHUB_RATE_LIMITED', 'GitHub API rate limit reached. Try again later.')
    }
    if (error instanceof GitHubApiError && error.status === 403) {
      throw new HttpError(403, 'GITHUB_ACCESS_DENIED', 'GitHub did not grant access to the installed repositories')
    }
    if (error.name === 'GitHubNetworkError') {
      throw new HttpError(502, 'GITHUB_UNAVAILABLE', 'GitHub could not be reached. Try again later.')
    }
    if (error instanceof GitHubApiError) {
      throw new HttpError(502, 'GITHUB_UNAVAILABLE', 'GitHub could not complete the request. Try again later.')
    }
    throw error
  }
}

async function getAuthorizedRepository(userId, repositoryId) {
  if (!/^\d{1,20}$/.test(String(repositoryId))) {
    throw new HttpError(400, 'INVALID_REPOSITORY_ID', 'Repository ID is invalid')
  }

  const connection = await GitHubConnection.findOne({ userId })
    .select('+accessToken +refreshToken')
  if (!connection) {
    throw new HttpError(404, 'GITHUB_NOT_CONNECTED', 'Connect a GitHub account first')
  }
  if (connection.status !== 'connected') {
    throw new HttpError(409, 'GITHUB_REAUTH_REQUIRED', 'Reconnect your GitHub account to continue')
  }

  const accessToken = await getValidAccessToken(connection)
  let repositories
  try {
    repositories = await listAccessibleRepositories(accessToken)
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 401) {
      await markReconnectRequired(connection)
    }
    if (error instanceof GitHubApiError && error.remainingRateLimit === '0') {
      throw new HttpError(503, 'GITHUB_RATE_LIMITED', 'GitHub API rate limit reached. Try again later.')
    }
    if (error instanceof GitHubApiError && error.status === 403) {
      throw new HttpError(403, 'GITHUB_ACCESS_DENIED', 'GitHub did not grant access to this repository')
    }
    if (error.name === 'GitHubNetworkError') {
      throw new HttpError(502, 'GITHUB_UNAVAILABLE', 'GitHub could not be reached. Try again later.')
    }
    if (error instanceof GitHubApiError) {
      throw new HttpError(502, 'GITHUB_UNAVAILABLE', 'GitHub could not complete the request. Try again later.')
    }
    throw error
  }

  const repository = repositories.find((item) => String(item.id) === String(repositoryId))
  if (!repository) {
    throw new HttpError(404, 'REPOSITORY_NOT_ACCESSIBLE', 'Repository is unavailable or not accessible to this account')
  }

  return { connection, accessToken, repository }
}

export async function getGitHubRepositoryTree(userId, repositoryId) {
  const { connection, accessToken, repository } = await getAuthorizedRepository(userId, repositoryId)
  try {
    const result = await getRepositoryTree(accessToken, repository)
    return { repository, ...result }
  } catch (error) {
    await mapRepositoryReadError(error, connection, 'GitHub could not load the repository tree')
  }
}

export async function getGitHubRepositoryFilesForIndex(userId, repositoryId, paths) {
  if (!Array.isArray(paths) || paths.length > 150) {
    throw new HttpError(400, 'INVALID_INDEX_FILE_LIST', 'The repository index file selection is invalid')
  }

  const { connection, accessToken, repository } = await getAuthorizedRepository(userId, repositoryId)
  let tree
  try {
    tree = await getRepositoryTree(accessToken, repository)
  } catch (error) {
    await mapRepositoryReadError(error, connection, 'GitHub could not load the repository tree')
  }

  const entryByPath = new Map(tree.entries.map((entry) => [entry.path, entry]))
  const candidates = paths.map((path) => {
    if (typeof path !== 'string' || path.length > 1024
      || path.startsWith('/') || path.includes('\\') || path.includes('\0')
      || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new HttpError(400, 'INVALID_FILE_PATH', 'Index contains an invalid file path')
    }
    const entry = entryByPath.get(path)
    if (!entry) throw new HttpError(400, 'INVALID_FILE_PATH', 'Index file is not present in the current repository tree')
    return entry
  })

  const results = new Array(candidates.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(4, candidates.length) }, async () => {
    while (nextIndex < candidates.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      const entry = candidates[currentIndex]
      if (entry.size > 256 * 1024) {
        results[currentIndex] = { path: entry.path, skipped: 'too_large' }
        continue
      }
      try {
        const file = await getRepositoryTextFile(accessToken, repository, entry.path, tree.commitSha)
        results[currentIndex] = { ...file, skipped: null }
      } catch (error) {
        if (error.name === 'GitHubFileNotTextError') {
          results[currentIndex] = { path: entry.path, skipped: 'binary' }
          continue
        }
        if (error.name === 'GitHubFileTooLargeError') {
          results[currentIndex] = { path: entry.path, skipped: 'too_large' }
          continue
        }
        await mapRepositoryReadError(error, connection, 'GitHub could not retrieve files for indexing')
      }
    }
  })
  await Promise.all(workers)

  return {
    repository: {
      id: repository.id,
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
    },
    commitSha: tree.commitSha,
    treeTruncated: tree.truncated,
    files: results,
  }
}

export async function getGitHubRepositoryFile(userId, repositoryId, path) {
  if (typeof path !== 'string' || path.length < 1 || path.length > 1024
    || path.startsWith('/') || path.includes('\\') || path.includes('\0')
    || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new HttpError(400, 'INVALID_FILE_PATH', 'File path is invalid')
  }

  const { connection, accessToken, repository } = await getAuthorizedRepository(userId, repositoryId)
  let tree
  try {
    tree = await getRepositoryTree(accessToken, repository)
  } catch (error) {
    await mapRepositoryReadError(error, connection, 'GitHub could not load the repository tree')
  }

  const entry = tree.entries.find((item) => item.path === path)
  if (!entry) {
    throw new HttpError(404, 'FILE_NOT_FOUND', 'File was not found in the repository tree')
  }
  if (entry.size > 256 * 1024) {
    throw new HttpError(413, 'FILE_TOO_LARGE', 'File exceeds the 256 KiB preview limit')
  }

  try {
    return await getRepositoryTextFile(accessToken, repository, path)
  } catch (error) {
    if (error.name === 'GitHubFileTooLargeError') {
      throw new HttpError(413, 'FILE_TOO_LARGE', 'File exceeds the 256 KiB preview limit')
    }
    if (error.name === 'GitHubFileNotTextError') {
      throw new HttpError(415, 'FILE_NOT_TEXT', 'This file is binary or cannot be previewed as text')
    }
    if (error instanceof GitHubApiError && error.status === 404) {
      throw new HttpError(404, 'FILE_NOT_FOUND', 'File was not found in the repository')
    }
    await mapRepositoryReadError(error, connection, 'GitHub could not retrieve the file')
  }
}

function validatePublicRepositoryName(owner, name) {
  const validOwner = typeof owner === 'string'
    && owner.length <= 39
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner)
  const validName = typeof name === 'string'
    && name.length <= 100
    && name !== '.'
    && name !== '..'
    && /^[A-Za-z0-9_.-]+$/.test(name)
  if (!validOwner || !validName) {
    throw new HttpError(400, 'INVALID_REPOSITORY_NAME', 'Enter a valid GitHub owner and repository name')
  }
}

async function resolvePublicRepository(owner, name) {
  validatePublicRepositoryName(owner, name)
  try {
    const result = await getPublicRepository(owner, name)
    if (!Number.isSafeInteger(result.id) || result.private !== false
      || typeof result.full_name !== 'string' || typeof result.name !== 'string'
      || result.full_name.toLowerCase() !== `${owner}/${name}`.toLowerCase()) {
      throw new HttpError(404, 'PUBLIC_REPOSITORY_NOT_FOUND', 'Public repository was not found')
    }
    return {
      id: result.id,
      name: result.name,
      fullName: result.full_name,
      private: false,
      url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      defaultBranch: typeof result.default_branch === 'string' ? result.default_branch : '',
    }
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error instanceof GitHubApiError && error.status === 404) {
      throw new HttpError(404, 'PUBLIC_REPOSITORY_NOT_FOUND', 'Public repository was not found')
    }
    if (error instanceof GitHubApiError && error.remainingRateLimit === '0') {
      throw new HttpError(503, 'GITHUB_RATE_LIMITED', 'GitHub API rate limit reached. Try again later.')
    }
    if (error instanceof GitHubApiError && error.status === 403) {
      throw new HttpError(503, 'GITHUB_RATE_LIMITED', 'GitHub public API rate limit reached. Try again later.')
    }
    if (error?.name === 'GitHubNetworkError') {
      throw new HttpError(502, 'GITHUB_UNAVAILABLE', 'GitHub could not be reached. Try again later.')
    }
    if (error instanceof GitHubApiError) {
      throw new HttpError(502, 'GITHUB_UNAVAILABLE', 'GitHub could not complete the request. Try again later.')
    }
    throw error
  }
}

export async function getPublicGitHubRepository(owner, name) {
  return resolvePublicRepository(owner, name)
}

export async function getPublicGitHubRepositoryTree(owner, name) {
  const repository = await resolvePublicRepository(owner, name)
  if (!repository.defaultBranch) {
    return { repository, entries: [], truncated: false, commitSha: '' }
  }
  try {
    const tree = await getRepositoryTree(null, repository)
    return { repository, ...tree }
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      throw new HttpError(404, 'PUBLIC_REPOSITORY_NOT_FOUND', 'Repository branch was not found')
    }
    if (error instanceof GitHubApiError && error.remainingRateLimit === '0') {
      throw new HttpError(503, 'GITHUB_RATE_LIMITED', 'GitHub API rate limit reached. Try again later.')
    }
    if (error instanceof GitHubApiError && error.status === 403) {
      throw new HttpError(503, 'GITHUB_RATE_LIMITED', 'GitHub public API rate limit reached. Try again later.')
    }
    if (error?.name === 'GitHubNetworkError') {
      throw new HttpError(502, 'GITHUB_UNAVAILABLE', 'GitHub could not be reached. Try again later.')
    }
    throw error
  }
}

export async function getPublicGitHubRepositoryFile(owner, name, path) {
  if (typeof path !== 'string' || path.length < 1 || path.length > 1024
    || path.startsWith('/') || path.includes('\\') || path.includes('\0')
    || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new HttpError(400, 'INVALID_FILE_PATH', 'File path is invalid')
  }

  const tree = await getPublicGitHubRepositoryTree(owner, name)
  const entry = tree.entries.find((item) => item.path === path)
  if (!entry) {
    throw new HttpError(404, 'FILE_NOT_FOUND', 'File was not found in the repository tree')
  }
  if (entry.size > 256 * 1024) {
    throw new HttpError(413, 'FILE_TOO_LARGE', 'File exceeds the 256 KiB preview limit')
  }

  try {
    return await getRepositoryTextFile(null, tree.repository, path, tree.commitSha || tree.repository.defaultBranch)
  } catch (error) {
    if (error.name === 'GitHubFileTooLargeError') {
      throw new HttpError(413, 'FILE_TOO_LARGE', 'File exceeds the 256 KiB preview limit')
    }
    if (error.name === 'GitHubFileNotTextError') {
      throw new HttpError(415, 'FILE_NOT_TEXT', 'This file is binary or cannot be previewed as text')
    }
    if (error instanceof GitHubApiError && error.status === 404) {
      throw new HttpError(404, 'FILE_NOT_FOUND', 'File was not found in the repository')
    }
    if (error instanceof GitHubApiError && error.remainingRateLimit === '0') {
      throw new HttpError(503, 'GITHUB_RATE_LIMITED', 'GitHub API rate limit reached. Try again later.')
    }
    if (error instanceof GitHubApiError && error.status === 403) {
      throw new HttpError(503, 'GITHUB_RATE_LIMITED', 'GitHub public API rate limit reached. Try again later.')
    }
    if (error?.name === 'GitHubNetworkError') {
      throw new HttpError(502, 'GITHUB_UNAVAILABLE', 'GitHub could not be reached. Try again later.')
    }
    throw error
  }
}

export async function disconnectGitHub(userId) {
  await GitHubConnection.deleteOne({ userId })
  await GitHubOAuthState.deleteMany({ userId })
  await RagChunk.deleteMany({ userId })
  await RagIndex.deleteMany({ userId })
}

export function getGitHubFrontendOrigin() {
  return getValidatedFrontendUrl().origin
}