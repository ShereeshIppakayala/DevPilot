import assert from 'node:assert/strict'
import bcrypt from 'bcrypt'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { app } from '../src/app.js'
import { User } from '../src/models/user.model.js'

process.env.JWT_SECRET = randomBytes(32).toString('base64')

const originalFindOne = User.findOne
const originalFindById = User.findById
const originalCreate = User.create

function stubFindOne(callback) {
  User.findOne = (filter) => ({ select: (fields) => callback(filter, fields) })
}

function makeUser(overrides = {}) {
  return {
    _id: '64b64c2f8f7f5a001234abcd',
    email: 'developer@example.com',
    passwordHash: '$2b$12$' + 'a'.repeat(53),
    displayName: 'Dev Pilot',
    status: 'active',
    emailVerifiedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

async function withApi(testContext, callback) {
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  testContext.after(() => new Promise((resolve) => server.close(resolve)))
  testContext.after(() => {
    User.findOne = originalFindOne
    User.findById = originalFindById
    User.create = originalCreate
  })

  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  await callback(`http://127.0.0.1:${address.port}`)
}

test('registration hashes the password and returns only safe user fields', async (context) => {
  let createdDocument
  stubFindOne(async (filter, projection) => {
    assert.deepEqual(filter, { email: 'developer@example.com' })
    assert.equal(projection, '_id')
    return null
  })
  User.create = async (document) => {
    createdDocument = document
    return makeUser({ ...document, _id: '64b64c2f8f7f5a001234abcd' })
  }

  await withApi(context, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: ' Developer@Example.com ',
        password: 'CorrectHorse12!',
        displayName: 'Dev Pilot',
      }),
    })
    const body = await response.json()

    assert.equal(response.status, 201)
    assert.equal(createdDocument.email, 'developer@example.com')
    assert.notEqual(createdDocument.passwordHash, 'CorrectHorse12!')
    assert.equal(await bcrypt.compare('CorrectHorse12!', createdDocument.passwordHash), true)
    assert.equal(body.user.email, 'developer@example.com')
    assert.equal('passwordHash' in body.user, false)
  })
})

test('registration rejects invalid input and duplicate email', async (context) => {
  let lookupCount = 0
  stubFindOne(async () => {
    lookupCount += 1
    return makeUser()
  })

  await withApi(context, async (baseUrl) => {
    const invalidResponse = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'bad', password: 'short' }),
    })
    assert.equal(invalidResponse.status, 400)
    assert.equal((await invalidResponse.json()).error.code, 'VALIDATION_ERROR')
    assert.equal(lookupCount, 0)

    const duplicateResponse = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'developer@example.com', password: 'CorrectHorse12!' }),
    })
    assert.equal(duplicateResponse.status, 409)
    assert.equal((await duplicateResponse.json()).error.code, 'EMAIL_ALREADY_REGISTERED')
  })
})

test('login issues a short-lived JWT and /auth/me requires the valid bearer token', async (context) => {
  const user = makeUser({ passwordHash: await bcrypt.hash('CorrectHorse12!', 4) })
  stubFindOne(async (_filter, projection) => {
    assert.equal(projection, '+passwordHash')
    return user
  })
  User.findById = async (userId) => userId === user._id ? user : null

  await withApi(context, async (baseUrl) => {
    const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ' DEVELOPER@example.com ', password: 'CorrectHorse12!' }),
    })
    const loginBody = await loginResponse.json()
    assert.equal(loginResponse.status, 200)
    assert.equal(loginBody.tokenType, 'Bearer')
    assert.equal(loginBody.expiresIn, 900)
    assert.equal('passwordHash' in loginBody.user, false)

    const unauthorizedResponse = await fetch(`${baseUrl}/api/v1/auth/me`)
    assert.equal(unauthorizedResponse.status, 401)

    const profileResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${loginBody.accessToken}` },
    })
    const profileBody = await profileResponse.json()
    assert.equal(profileResponse.status, 200)
    assert.equal(profileBody.user.email, user.email)
    assert.equal('passwordHash' in profileBody.user, false)

    user.status = 'suspended'
    const suspendedResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${loginBody.accessToken}` },
    })
    assert.equal(suspendedResponse.status, 403)
    assert.equal((await suspendedResponse.json()).error.code, 'ACCOUNT_UNAVAILABLE')
    user.status = 'active'

    const invalidTokenResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { authorization: 'Bearer invalid.token.value' },
    })
    assert.equal(invalidTokenResponse.status, 401)
    assert.equal((await invalidTokenResponse.json()).error.code, 'INVALID_OR_EXPIRED_TOKEN')
  })
})

test('login uses one generic error for unknown users and wrong passwords', async (context) => {
  let userToReturn = null
  stubFindOne(async () => userToReturn)

  await withApi(context, async (baseUrl) => {
    const unknownResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@example.com', password: 'IncorrectPass12' }),
    })
    const unknownBody = await unknownResponse.json()

    userToReturn = makeUser({ passwordHash: await bcrypt.hash('CorrectHorse12!', 4) })
    const wrongPasswordResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'developer@example.com', password: 'IncorrectPass12' }),
    })
    const wrongPasswordBody = await wrongPasswordResponse.json()

    assert.equal(unknownResponse.status, 401)
    assert.equal(wrongPasswordResponse.status, 401)
    assert.deepEqual(unknownBody.error, { ...wrongPasswordBody.error, requestId: unknownBody.error.requestId })
    assert.equal(unknownBody.error.code, 'INVALID_CREDENTIALS')
    assert.equal(unknownBody.error.message, wrongPasswordBody.error.message)
  })
})