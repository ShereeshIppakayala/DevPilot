import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { askRepository, getRagStatus, indexRepository } from '../controllers/rag.controller.js'
import { requireAuth } from '../middleware/require-auth.js'

export const ragRouter = Router()

const ragRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({
      error: {
        code: 'RAG_RATE_LIMITED',
        message: 'Too many repository indexing or question requests. Try again later.',
        requestId: req.requestId,
      },
    })
  },
})

ragRouter.get('/integrations/github/repositories/:repositoryId/rag', requireAuth, ragRateLimit, getRagStatus)
ragRouter.post('/integrations/github/repositories/:repositoryId/rag/index', requireAuth, ragRateLimit, indexRepository)
ragRouter.post('/integrations/github/repositories/:repositoryId/rag/ask', requireAuth, ragRateLimit, askRepository)