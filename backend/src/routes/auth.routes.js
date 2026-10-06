import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { getCurrentUser, login, register } from '../controllers/auth.controller.js'
import { requireAuth } from '../middleware/require-auth.js'

export const authRouter = Router()

const authRateLimit = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 10,
	standardHeaders: true,
	legacyHeaders: false,
	handler(req, res) {
		res.status(429).json({
			error: {
				code: 'AUTH_RATE_LIMITED',
				message: 'Too many authentication attempts. Try again later.',
				requestId: req.requestId,
			},
		})
	},
})

authRouter.post('/auth/register', authRateLimit, register)
authRouter.post('/auth/login', authRateLimit, login)
authRouter.get('/auth/me', requireAuth, getCurrentUser)