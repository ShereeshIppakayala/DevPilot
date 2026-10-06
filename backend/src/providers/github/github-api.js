const apiBaseUrl = 'https://api.github.com'
const apiVersion = '2026-03-10'

export class GitHubApiError extends Error {
  constructor(status, remainingRateLimit) {
    super('GitHub API request failed')
    this.name = 'GitHubApiError'
    this.status = status
    this.remainingRateLimit = remainingRateLimit
  }
}

async function requestJson(url, accessToken) {
  let response
  try {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': apiVersion,
    }
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    const error = new Error('GitHub could not be reached')
    error.name = 'GitHubNetworkError'
    throw error
  }

  if (!response.ok) {
    throw new GitHubApiError(response.status, response.headers.get('x-ratelimit-remaining'))
  }

  return response.json()
}

export async function exchangeAuthorizationCode({ code, clientId, clientSecret, callbackUrl }) {
  let response
  try {
    response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callbackUrl,
      }),
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    const error = new Error('GitHub authorization could not be completed')
    error.name = 'GitHubNetworkError'
    throw error
  }

  const payload = await response.json()
  if (!response.ok || payload.error || !payload.access_token) {
    const error = new Error('GitHub authorization could not be completed')
    error.name = 'GitHubTokenExchangeError'
    throw error
  }
  return payload
}

export async function refreshUserAccessToken({ refreshToken, clientId, clientSecret }) {
  let response
  try {
    response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    const error = new Error('GitHub token refresh could not be completed')
    error.name = 'GitHubNetworkError'
    throw error
  }

  const payload = await response.json()
  if (!response.ok || payload.error || !payload.access_token) {
    const error = new Error('GitHub token refresh was rejected')
    error.name = 'GitHubRefreshError'
    throw error
  }
  return payload
}

export async function getGitHubUser(accessToken) {
  return requestJson(`${apiBaseUrl}/user`, accessToken)
}

export async function getPublicRepository(owner, name) {
  return requestJson(
    `${apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
  )
}

async function getAllPages(urlForPage, accessToken, collectionKey) {
  const results = []
  for (let page = 1; ; page += 1) {
    const payload = await requestJson(urlForPage(page), accessToken)
    const pageItems = payload[collectionKey]
    if (!Array.isArray(pageItems)) throw new Error('Unexpected GitHub API response')
    results.push(...pageItems)
    if (pageItems.length < 100) return results
  }
}

export async function listAccessibleRepositories(accessToken) {
  const installations = await getAllPages(
    (page) => `${apiBaseUrl}/user/installations?per_page=100&page=${page}`,
    accessToken,
    'installations',
  )

  const repositories = []
  for (const installation of installations) {
    const installedRepositories = await getAllPages(
      (page) => `${apiBaseUrl}/user/installations/${installation.id}/repositories?per_page=100&page=${page}`,
      accessToken,
      'repositories',
    )
    repositories.push(...installedRepositories)
  }

  const uniqueRepositories = new Map()
  for (const repository of repositories) {
    uniqueRepositories.set(repository.id, {
      id: repository.id,
      name: repository.name,
      fullName: repository.full_name,
      private: repository.private,
      url: repository.html_url,
      defaultBranch: repository.default_branch,
    })
  }

  return [...uniqueRepositories.values()]
}

function safeRepositoryName(fullName) {
  if (typeof fullName !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) {
    throw new Error('Invalid canonical repository name')
  }
  return fullName.split('/')
}

function encodePath(path) {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

export async function getRepositoryTree(accessToken, repository) {
  const [owner, name] = safeRepositoryName(repository.fullName)
  const branch = await requestJson(
    `${apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches/${encodeURIComponent(repository.defaultBranch)}`,
    accessToken,
  )
  const treeSha = branch?.commit?.commit?.tree?.sha
  if (typeof treeSha !== 'string' || !/^[a-f\d]{40}$/i.test(treeSha)) {
    throw new Error('GitHub returned an invalid branch tree')
  }

  const tree = await requestJson(
    `${apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${treeSha}?recursive=1`,
    accessToken,
  )
  if (!Array.isArray(tree.tree)) throw new Error('GitHub returned an invalid repository tree')

  const entries = tree.tree
    .filter((entry) => entry.type === 'blob' && entry.mode !== '120000' && typeof entry.path === 'string')
    .slice(0, 20000)
    .map((entry) => ({ path: entry.path, size: Number(entry.size) || 0 }))

  return {
    entries,
    truncated: tree.truncated === true || tree.tree.length > 20000,
    commitSha: branch.commit.sha,
  }
}

export async function getRepositoryTextFile(accessToken, repository, path, ref = repository.defaultBranch) {
  const [owner, name] = safeRepositoryName(repository.fullName)
  const payload = await requestJson(
    `${apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
    accessToken,
  )

  if (Array.isArray(payload) || payload.type !== 'file') {
    throw new Error('Requested path is not a file')
  }
  if (!Number.isSafeInteger(payload.size) || payload.size < 0) {
    throw new Error('GitHub returned an invalid file size')
  }
  if (payload.size > 256 * 1024) {
    const error = new Error('File exceeds the preview size limit')
    error.name = 'GitHubFileTooLargeError'
    error.size = payload.size
    throw error
  }
  if (payload.encoding !== 'base64' || typeof payload.content !== 'string') {
    const error = new Error('GitHub did not return text content for this file')
    error.name = 'GitHubFileNotTextError'
    throw error
  }

  const buffer = Buffer.from(payload.content.replace(/\s/g, ''), 'base64')
  if (buffer.length > 256 * 1024) {
    const error = new Error('File exceeds the preview size limit')
    error.name = 'GitHubFileTooLargeError'
    error.size = buffer.length
    throw error
  }
  let content
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    const error = new Error('Binary files cannot be previewed')
    error.name = 'GitHubFileNotTextError'
    throw error
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/.test(content)) {
    const error = new Error('Binary files cannot be previewed')
    error.name = 'GitHubFileNotTextError'
    throw error
  }

  return {
    path: payload.path,
    size: buffer.length,
    content,
    encoding: 'utf-8',
  }
}