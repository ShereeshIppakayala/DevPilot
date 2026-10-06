import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import {
  analyzePublicRepositoryFileController,
  analyzeRepositoryFileController,
} from '../controllers/code-analysis.controller.js'
import { requireAuth } from '../middleware/require-auth.js'

export const codeAnalysisRouter = Router()

const analysisRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({
      error: {
        code: 'AI_REQUEST_RATE_LIMITED',
        message: 'Too many AI analysis requests. Try again later.',
        requestId: req.requestId,
      },
    })
  },
})

codeAnalysisRouter.post(
  '/integrations/github/repositories/:repositoryId/analyze',
  requireAuth,
  analysisRateLimit,
  analyzeRepositoryFileController,
)
codeAnalysisRouter.post(
  '/integrations/github/public-repositories/:owner/:repository/analyze',
  requireAuth,
  analysisRateLimit,
  analyzePublicRepositoryFileController,
)