const defaultPort = 4000

function readPort(value) {
  if (value === undefined || value === '') return defaultPort

  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }

  return port
}

export const config = Object.freeze({
  environment: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '127.0.0.1',
  port: readPort(process.env.PORT),
  mongodbUri: process.env.MONGODB_URI ?? '',
  mongodbServerSelectionTimeoutMs: 5000,
  githubAppClientId: process.env.GITHUB_APP_CLIENT_ID?.trim() ?? '',
  githubAppClientSecret: process.env.GITHUB_APP_CLIENT_SECRET?.trim() ?? '',
  githubAppSlug: process.env.GITHUB_APP_SLUG?.trim() ?? '',
  githubAppCallbackUrl: process.env.GITHUB_APP_CALLBACK_URL?.trim() ?? '',
  githubTokenEncryptionKey: process.env.GITHUB_TOKEN_ENCRYPTION_KEY?.trim() ?? '',
  frontendUrl: process.env.FRONTEND_URL?.trim() ?? 'http://localhost:5173',
  llmApiKey: process.env.LLM_API_KEY?.trim() ?? '',
  llmModel: process.env.LLM_MODEL?.trim() || 'gemini-3.8-flash',
})

export function assertAuthConfiguration() {
  const secret = process.env.JWT_SECRET
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be set to a random value of at least 32 bytes')
  }
}