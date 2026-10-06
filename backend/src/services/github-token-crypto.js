import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { config } from '../config/env.js'

function encryptionKey() {
  const key = Buffer.from(config.githubTokenEncryptionKey, 'base64url')
  if (key.length !== 32) {
    throw new Error('GITHUB_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes')
  }
  return key
}

export function encryptGitHubToken(token) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])

  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
  }
}

export function decryptGitHubToken(encryptedToken) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(encryptedToken.iv, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(encryptedToken.authTag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedToken.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}