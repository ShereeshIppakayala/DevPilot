import { verifyAccessToken } from '../services/auth.service.js'
import { User } from '../models/user.model.js'

export async function requireAuth(req, res, next) {
  const authorization = req.get('authorization')
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/)

  if (!match) {
    return res.status(401).json({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'A valid bearer token is required',
        requestId: req.requestId,
      },
    })
  }

  let claims
  try {
    claims = verifyAccessToken(match[1])
  } catch {
    return res.status(401).json({
      error: {
        code: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'The bearer token is invalid or expired',
        requestId: req.requestId,
      },
    })
  }

  if (typeof claims.sub !== 'string' || !/^[a-f\d]{24}$/i.test(claims.sub)) {
    return res.status(401).json({
      error: {
        code: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'The bearer token is invalid or expired',
        requestId: req.requestId,
      },
    })
  }

  const user = await User.findById(claims.sub)
  if (!user) {
    return res.status(401).json({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required',
        requestId: req.requestId,
      },
    })
  }

  if (user.status !== 'active') {
    return res.status(403).json({
      error: {
        code: 'ACCOUNT_UNAVAILABLE',
        message: 'This account is not available',
        requestId: req.requestId,
      },
    })
  }

  req.auth = { userId: claims.sub }
  req.user = user
  return next()
}