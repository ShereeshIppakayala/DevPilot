import assert from 'node:assert/strict'
import test from 'node:test'
import { User } from '../src/models/user.model.js'

test('User normalizes and validates account fields without a database', async () => {
  const user = new User({
    email: '  Developer@Example.com ',
    passwordHash: '$2b$12$' + 'a'.repeat(53),
    displayName: '  Dev Pilot  ',
  })

  await user.validate()

  assert.equal(user.email, 'developer@example.com')
  assert.equal(user.displayName, 'Dev Pilot')
  assert.equal(user.status, 'active')
  assert.equal(user.emailVerifiedAt, null)
  assert.equal(user.createdAt, undefined)
  assert.equal(user.updatedAt, undefined)
  assert.equal(User.schema.path('passwordHash').options.select, false)
  assert.deepEqual(User.schema.indexes().find(([fields]) => fields.email), [
    { email: 1 },
    { unique: true, name: 'uniq_users_email' },
  ])
})

test('User rejects invalid email, plaintext password fields, and unknown fields', async () => {
  const invalidEmailUser = new User({ email: 'not-an-email' })
  await assert.rejects(invalidEmailUser.validate(), { name: 'ValidationError' })

  const plaintextHashUser = new User({
    email: 'developer@example.com',
    passwordHash: 'plain-text-password',
  })
  await assert.rejects(plaintextHashUser.validate(), { name: 'ValidationError' })

  assert.throws(() => new User({
    email: 'developer@example.com',
    password: 'plain-text-password',
  }), { name: 'StrictModeError' })
})

test('password hashes are excluded from normal queries and JSON output', async () => {
  const user = new User({
    email: 'developer@example.com',
    passwordHash: '$2b$12$' + 'a'.repeat(53),
  })
  const serialized = user.toJSON()

  assert.equal(User.schema.path('passwordHash').options.select, false)
  assert.equal('passwordHash' in serialized, false)
})