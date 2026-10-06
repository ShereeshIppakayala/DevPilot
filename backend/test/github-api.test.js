import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import {
  getRepositoryTextFile,
  getRepositoryTree,
  getPublicRepository,
  GitHubApiError,
  listAccessibleRepositories,
} from '../src/providers/github/github-api.js'
import { GitHubConnection } from '../src/models/github-connection.model.js'
import { GitHubOAuthState } from '../src/models/github-oauth-state.model.js'

test('repository listing uses GitHub installation endpoints and returns a safe projection', async (context) => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    const payload = String(url).includes('/user/installations?')
      ? { installations: [{ id: 42 }] }
      : { repositories: [{
          id: 7,
          name: 'devpilot',
          full_name: 'example/devpilot',
          private: true,
          html_url: 'https://github.com/example/devpilot',
          default_branch: 'main',
          permissions: { admin: true },
          secrets: 'must-not-be-returned',
        }] }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  context.after(() => { globalThis.fetch = originalFetch })

  const repositories = await listAccessibleRepositories('github-access-token')
  assert.deepEqual(repositories, [{
    id: 7,
    name: 'devpilot',
    fullName: 'example/devpilot',
    private: true,
    url: 'https://github.com/example/devpilot',
    defaultBranch: 'main',
  }])
  assert.equal(calls.length, 2)
  assert.match(calls[0].url, /api\.github\.com\/user\/installations\?per_page=100&page=1/)
  assert.match(calls[1].url, /api\.github\.com\/user\/installations\/42\/repositories\?per_page=100&page=1/)
  assert.equal(calls[0].options.headers.Authorization, 'Bearer github-access-token')
  assert.equal(calls[0].options.headers['X-GitHub-Api-Version'], '2026-03-10')
})

test('repository listing follows pagination for installations and repositories', async (context) => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    const value = String(url)
    calls.push(value)
    if (value.includes('/user/installations?')) {
      const page = Number(new URL(value).searchParams.get('page'))
      return new Response(JSON.stringify({ installations: page === 1 ? [{ id: 9 }] : [] }))
    }
    const page = Number(new URL(value).searchParams.get('page'))
    const repositories = page === 1
      ? Array.from({ length: 100 }, (_, index) => ({
          id: index + 1,
          name: `repo-${index + 1}`,
          full_name: `org/repo-${index + 1}`,
          private: false,
          html_url: `https://github.com/org/repo-${index + 1}`,
          default_branch: 'main',
        }))
      : [{ id: 101, name: 'repo-101', full_name: 'org/repo-101', private: true, html_url: 'https://github.com/org/repo-101', default_branch: 'main' }]
    return new Response(JSON.stringify({ repositories }))
  }
  context.after(() => { globalThis.fetch = originalFetch })

  const repositories = await listAccessibleRepositories('token')
  assert.equal(repositories.length, 101)
  assert.ok(calls.some((url) => url.endsWith('repositories?per_page=100&page=2')))
})

test('public repository lookup does not send GitHub credentials', async (context) => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options }
    return new Response(JSON.stringify({
      id: 7,
      name: 'react',
      full_name: 'facebook/react',
      private: false,
      default_branch: 'main',
    }))
  }
  context.after(() => { globalThis.fetch = originalFetch })

  const repository = await getPublicRepository('facebook', 'react')
  assert.equal(repository.full_name, 'facebook/react')
  assert.match(request.url, /api\.github\.com\/repos\/facebook\/react$/)
  assert.equal(request.options.headers.Authorization, undefined)
  assert.equal(request.options.headers.Accept, 'application/vnd.github+json')
})

test('public repositories load tree and text file without GitHub credentials', async (context) => {
  const originalFetch = globalThis.fetch
  const requests = []
  const content = 'export const answer = 42\n'
  globalThis.fetch = async (url, options) => {
    const value = String(url)
    requests.push({ url: value, headers: options.headers })
    if (value.endsWith('/repos/example/project')) {
      return new Response(JSON.stringify({
        id: 42,
        name: 'project',
        full_name: 'example/project',
        private: false,
        default_branch: 'main',
      }))
    }
    if (value.endsWith('/branches/main')) {
      return new Response(JSON.stringify({
        commit: {
          sha: 'a'.repeat(40),
          commit: { tree: { sha: 'b'.repeat(40) } },
        },
      }))
    }
    if (value.includes(`/git/trees/${'b'.repeat(40)}?recursive=1`)) {
      return new Response(JSON.stringify({
        truncated: false,
        tree: [{ path: 'src/index.js', type: 'blob', size: Buffer.byteLength(content) }],
      }))
    }
    if (value.includes('/contents/src/index.js?ref=')) {
      return new Response(JSON.stringify({
        type: 'file',
        path: 'src/index.js',
        size: Buffer.byteLength(content),
        encoding: 'base64',
        content: Buffer.from(content).toString('base64'),
      }))
    }
    throw new Error(`Unexpected GitHub URL ${value}`)
  }
  context.after(() => { globalThis.fetch = originalFetch })

  const repository = await getPublicRepository('example', 'project')
  const tree = await getRepositoryTree(null, {
    fullName: repository.full_name,
    defaultBranch: repository.default_branch,
  })
  assert.deepEqual(tree.entries, [{ path: 'src/index.js', size: Buffer.byteLength(content) }])
  const file = await getRepositoryTextFile(null, {
    fullName: repository.full_name,
    defaultBranch: repository.default_branch,
  }, 'src/index.js', tree.commitSha)
  assert.equal(file.content, content)
  assert.ok(requests.every((request) => request.headers.Authorization === undefined))
})

test('GitHub token encryption uses authenticated encryption and detects tampering', async () => {
  process.env.GITHUB_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64url')
  const { decryptGitHubToken, encryptGitHubToken } = await import('../src/services/github-token-crypto.js')

  const encrypted = encryptGitHubToken('sensitive-github-token')
  assert.notEqual(encrypted.ciphertext, 'sensitive-github-token')
  assert.equal(decryptGitHubToken(encrypted), 'sensitive-github-token')
  assert.throws(() => decryptGitHubToken({ ...encrypted, ciphertext: randomBytes(20).toString('base64url') }))
})

test('connection models hide encrypted credentials and expire OAuth state', () => {
  assert.equal(GitHubConnection.schema.path('accessToken').options.select, false)
  assert.equal(GitHubConnection.schema.path('refreshToken').options.select, false)
  assert.equal(GitHubConnection.schema.path('githubLogin').options.required, true)
  assert.ok(GitHubConnection.schema.indexes().some(([fields, options]) => fields.userId === 1 && options.unique))
  assert.equal(GitHubOAuthState.schema.path('expiresAt').options.expires, 0)
  assert.ok(GitHubOAuthState.schema.path('stateHash').options.unique)
})

test('GitHub API authorization failures expose only safe status metadata', async (context) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('private token error details', {
    status: 401,
    headers: { 'x-ratelimit-remaining': '4999' },
  })
  context.after(() => { globalThis.fetch = originalFetch })

  await assert.rejects(listAccessibleRepositories('revoked-token'), (error) => {
    assert.ok(error instanceof GitHubApiError)
    assert.equal(error.status, 401)
    assert.equal(error.message.includes('private token'), false)
    return true
  })
})

test('tree retrieval resolves the default branch and excludes symlinks and submodules', async (context) => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    const value = String(url)
    calls.push(value)
    if (value.includes('/branches/main')) {
      return new Response(JSON.stringify({
        commit: {
          sha: 'a'.repeat(40),
          commit: { tree: { sha: 'b'.repeat(40) } },
        },
      }))
    }
    return new Response(JSON.stringify({
      truncated: false,
      tree: [
        { path: 'src', type: 'tree' },
        { path: 'src/main.js', type: 'blob', size: 20 },
        { path: 'secret-link', type: 'blob', mode: '120000', size: 14 },
        { path: 'nested-module', type: 'commit', size: 0 },
      ],
    }))
  }
  context.after(() => { globalThis.fetch = originalFetch })

  const result = await getRepositoryTree('token', {
    fullName: 'owner/repository',
    defaultBranch: 'main',
  })
  assert.equal(result.commitSha, 'a'.repeat(40))
  assert.deepEqual(result.entries, [{ path: 'src/main.js', size: 20 }])
  assert.match(calls[1], new RegExp(`/git/trees/${'b'.repeat(40)}\\?recursive=1$`))
})

test('file retrieval decodes bounded UTF-8 text and rejects oversized or binary files', async (context) => {
  const originalFetch = globalThis.fetch
  const text = 'const answer = 42\n'
  let mode = 'text'
  globalThis.fetch = async () => {
    const payload = mode === 'large'
      ? { type: 'file', path: 'src/main.js', size: 262145, encoding: 'base64', content: '' }
      : { type: 'file', path: 'src/main.js', size: Buffer.byteLength(text), encoding: 'base64', content: Buffer.from(mode === 'binary' ? [0, 1, 2] : mode === 'invalid-utf8' ? [0xc3, 0x28] : text).toString('base64') }
    return new Response(JSON.stringify(payload))
  }
  context.after(() => { globalThis.fetch = originalFetch })

  const repository = { fullName: 'owner/repository', defaultBranch: 'main' }
  assert.deepEqual(await getRepositoryTextFile('token', repository, 'src/main.js'), {
    path: 'src/main.js',
    size: Buffer.byteLength(text),
    content: text,
    encoding: 'utf-8',
  })

  mode = 'large'
  await assert.rejects(getRepositoryTextFile('token', repository, 'src/main.js'), { name: 'GitHubFileTooLargeError' })
  mode = 'binary'
  await assert.rejects(getRepositoryTextFile('token', repository, 'src/main.js'), { name: 'GitHubFileNotTextError' })
  mode = 'invalid-utf8'
  await assert.rejects(getRepositoryTextFile('token', repository, 'src/main.js'), { name: 'GitHubFileNotTextError' })
})