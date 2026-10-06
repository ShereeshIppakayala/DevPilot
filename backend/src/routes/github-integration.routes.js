import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import {
  getGitHubRepositories,
  getGitHubStatus,
  getPublicRepository,
  getPublicRepositoryFile,
  getPublicRepositoryTree,
  getRepositoryFile,
  getRepositoryTree,
  handleGitHubCallback,
  removeGitHubConnection,
  startGitHubAuthorization,
} from '../controllers/github-integration.controller.js'
import { requireAuth } from '../middleware/require-auth.js'

export const githubIntegrationRouter = Router()

const connectRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({
      error: {
        code: 'GITHUB_CONNECT_RATE_LIMITED',
        message: 'Too many GitHub connection attempts. Try again later.',
        requestId: req.requestId,
      },
    })
  },
})

const repositoryReadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({
      error: {
        code: 'GITHUB_READ_RATE_LIMITED',
        message: 'Too many repository requests. Try again later.',
        requestId: req.requestId,
      },
    })
  },
})

githubIntegrationRouter.post('/integrations/github/connect', requireAuth, connectRateLimit, startGitHubAuthorization)
githubIntegrationRouter.get('/integrations/github/callback', handleGitHubCallback)
githubIntegrationRouter.get('/integrations/github/connection', requireAuth, getGitHubStatus)
githubIntegrationRouter.delete('/integrations/github/connection', requireAuth, removeGitHubConnection)
githubIntegrationRouter.get('/integrations/github/repositories', requireAuth, getGitHubRepositories)
githubIntegrationRouter.get('/integrations/github/repositories/:repositoryId/tree', requireAuth, repositoryReadRateLimit, getRepositoryTree)
githubIntegrationRouter.get('/integrations/github/repositories/:repositoryId/file', requireAuth, repositoryReadRateLimit, getRepositoryFile)
githubIntegrationRouter.get('/integrations/github/public-repositories/:owner/:repository', requireAuth, repositoryReadRateLimit, getPublicRepository)
githubIntegrationRouter.get('/integrations/github/public-repositories/:owner/:repository/tree', requireAuth, repositoryReadRateLimit, getPublicRepositoryTree)
githubIntegrationRouter.get('/integrations/github/public-repositories/:owner/:repository/file', requireAuth, repositoryReadRateLimit, getPublicRepositoryFile)