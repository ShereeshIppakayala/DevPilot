import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import test from 'node:test'
import { connectToDatabase } from '../src/config/database.js'

test('database connection rejects when the connection string is missing', async () => {
  await assert.rejects(connectToDatabase(''), /MONGODB_URI is required/)
  assert.notEqual(mongoose.connection.readyState, 1)
})

test('unreachable MongoDB rejects within the configured selection timeout', async () => {
  await assert.rejects(
    connectToDatabase('mongodb://127.0.0.1:1/devpilot', { serverSelectionTimeoutMs: 100 }),
  )
  assert.equal(mongoose.connection.readyState, 0)
})