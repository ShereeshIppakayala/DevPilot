import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import jwt from 'jsonwebtoken'
import test from 'node:test'

process.env.JWT_SECRET = randomBytes(48).toString('base64url')
process.env.GITHUB_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64url')

const [{ app }, { User }, { GitHubConnection }, cryptoModule] = await Promise.all([
  import('../src/app.js'),
  import('../src/models/user.model.js'),
  import('../src/models/github-connection.model.js'),
  import('../src/services/github-token-crypto.js'),
])

const originalFindById = User.findById
const originalFindOne = GitHubConnection.findOne
const originalFetch = globalThis.fetch
const authenticatedUserId = '64b64c2f8f7f5a001234abcd'

function tokenForUser() {
  return jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: authenticatedUserId,
    issuer: 'devpilot-api',
    audience: 'devpilot-web',
    expiresIn: '5m',
  })
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('authenticated users can load safe repository trees and bounded text files', async (context) => {
  const accessToken = 'mock-github-token'
  const encryptedAccessToken = cryptoModule.encryptGitHubToken(accessToken)
  const connection = {
    accessToken: encryptedAccessToken,
    refreshToken: undefined,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    status: 'connected',
    save: async () => {},
  }
  const contentCalls = []

  User.findById = async () => ({ _id: authenticatedUserId, status: 'active' })
  GitHubConnection.findOne = () => ({ select: async () => connection })
  globalThis.fetch = async (url, options) => {
    const requestUrl = new URL(String(url))
    if (requestUrl.hostname !== 'api.github.com') {
      return originalFetch(url, options)
    }
    if (requestUrl.pathname === '/user/installations') {
      return jsonResponse({ installations: [{ id: 50 }] })
    }
    if (requestUrl.pathname === '/user/installations/50/repositories') {
      return jsonResponse({ repositories: [{
        id: 123,
        name: 'sample',
        full_name: 'octo/sample',
        private: true,
        html_url: 'https://github.com/octo/sample',
        default_branch: 'main',
      }] })
    }
    if (requestUrl.pathname === '/repos/octo/sample/branches/main') {
      return jsonResponse({
        commit: {
          sha: 'a'.repeat(40),
          commit: { tree: { sha: 'b'.repeat(40) } },
        },
      })
    }
    if (requestUrl.pathname === `/repos/octo/sample/git/trees/${'b'.repeat(40)}`) {
      return jsonResponse({
        truncated: false,
        tree: [
          { path: 'src', type: 'tree' },
          { path: 'src/index.js', type: 'blob', mode: '100644', size: 18 },
          { path: 'linked-file', type: 'blob', mode: '120000', size: 18 },
          { path: 'large.log', type: 'blob', mode: '100644', size: 300 * 1024 },
        ],
      })
    }
    if (requestUrl.pathname === '/repos/octo/sample/contents/src/index.js') {
      contentCalls.push(requestUrl.pathname)
      return jsonResponse({
        type: 'file',
        path: 'src/index.js',
        size: 18,
        encoding: 'base64',
        content: Buffer.from('const value = 1;\n').toString('base64'),
      })
    }
    if (requestUrl.pathname === '/repos/octo/sample/contents/large.log') {
      contentCalls.push(requestUrl.pathname)
      return jsonResponse({ type: 'file', path: 'large.log', size: 300 * 1024, encoding: 'base64', content: '' })
    }
    throw new Error(`Unexpected test URL: ${requestUrl.pathname}`)
  }

  context.after(() => {
    User.findById = originalFindById
    GitHubConnection.findOne = originalFindOne
    globalThis.fetch = originalFetch
  })

  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const authorization = { authorization: `Bearer ${tokenForUser()}` }

  const unauthorized = await fetch(`${baseUrl}/api/v1/integrations/github/repositories/123/tree`)
  assert.equal(unauthorized.status, 401)

  const treeResponse = await fetch(`${baseUrl}/api/v1/integrations/github/repositories/123/tree`, { headers: authorization })
  const treeBody = await treeResponse.json()
  assert.equal(treeResponse.status, 200, `${treeBody.error?.code}: ${treeBody.error?.message}`)
  assert.deepEqual(treeBody.entries.map((entry) => entry.path), ['src/index.js', 'large.log'])

  const fileResponse = await fetch(`${baseUrl}/api/v1/integrations/github/repositories/123/file?path=src%2Findex.js`, { headers: authorization })
  const fileBody = await fileResponse.json()
  assert.equal(fileResponse.status, 200)
  assert.equal(fileBody.file.content, 'const value = 1;\n')
  assert.equal(contentCalls.length, 1)

  const traversalResponse = await fetch(`${baseUrl}/api/v1/integrations/github/repositories/123/file?path=..%2Fsecret.txt`, { headers: authorization })
  assert.equal(traversalResponse.status, 400)

  const inaccessibleResponse = await fetch(`${baseUrl}/api/v1/integrations/github/repositories/999/tree`, { headers: authorization })
  assert.equal(inaccessibleResponse.status, 404)

  const largeResponse = await fetch(`${baseUrl}/api/v1/integrations/github/repositories/123/file?path=large.log`, { headers: authorization })
  assert.equal(largeResponse.status, 413)
  assert.equal(contentCalls.length, 1)
})