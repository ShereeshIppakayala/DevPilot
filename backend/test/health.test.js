import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { app } from '../src/app.js'

test('health and not-found responses follow the API contract', async (context) => {
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(() => new Promise((resolve) => server.close(resolve)))

  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const baseUrl = `http://127.0.0.1:${address.port}`

  const healthResponse = await fetch(`${baseUrl}/api/v1/health`)
  const healthBody = await healthResponse.json()
  assert.equal(healthResponse.status, 200)
  assert.equal(healthBody.status, 'ok')
  assert.equal(healthResponse.headers.get('x-request-id'), healthBody.requestId)
  assert.ok(Number.isFinite(Date.parse(healthBody.timestamp)))

  const missingResponse = await fetch(`${baseUrl}/api/v1/missing`)
  const missingBody = await missingResponse.json()
  assert.equal(missingResponse.status, 404)
  assert.equal(missingBody.error.code, 'ROUTE_NOT_FOUND')
  assert.equal(missingResponse.headers.get('x-request-id'), missingBody.error.requestId)

  const invalidJsonResponse = await fetch(`${baseUrl}/api/v1/health`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  })
  const invalidJsonBody = await invalidJsonResponse.json()
  assert.equal(invalidJsonResponse.status, 400)
  assert.equal(invalidJsonBody.error.code, 'INVALID_JSON')
})