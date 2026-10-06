import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { User } from '../models/user.model.js'
import { HttpError } from '../utils/http-error.js'

const bcryptRounds = 12
const accessTokenLifetimeSeconds = 15 * 60
const jwtIssuer = 'devpilot-api'
const jwtAudience = 'devpilot-web'
const dummyPasswordHash = bcrypt.hash('not-a-real-password', bcryptRounds)

function jwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET is not configured securely')
  }
  return secret
}

export function toPublicUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName ?? '',
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt ?? null,
    createdAt: user.createdAt ?? null,
  }
}

export async function registerUser({ email, password, displayName }) {
  const existingUser = await User.findOne({ email }).select('_id')
  if (existingUser) {
    throw new HttpError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists')
  }

  const passwordHash = await bcrypt.hash(password, bcryptRounds)

  try {
    const user = await User.create({ email, passwordHash, displayName })
    return toPublicUser(user)
  } catch (error) {
    if (error?.code === 11000 && (error?.keyPattern?.email || error?.keyValue?.email)) {
      throw new HttpError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists')
    }
    throw error
  }
}

export async function loginUser({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash')
  const passwordHash = user?.passwordHash ?? await dummyPasswordHash
  const passwordMatches = await bcrypt.compare(password, passwordHash)

  if (!user || !passwordMatches) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect')
  }

  if (user.status !== 'active') {
    throw new HttpError(403, 'ACCOUNT_UNAVAILABLE', 'This account is not available')
  }

  const accessToken = jwt.sign({}, jwtSecret(), {
    algorithm: 'HS256',
    subject: user._id.toString(),
    issuer: jwtIssuer,
    audience: jwtAudience,
    expiresIn: accessTokenLifetimeSeconds,
  })

  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: accessTokenLifetimeSeconds,
    user: toPublicUser(user),
  }
}

export function verifyAccessToken(token) {
  return jwt.verify(token, jwtSecret(), {
    algorithms: ['HS256'],
    issuer: jwtIssuer,
    audience: jwtAudience,
  })
}

