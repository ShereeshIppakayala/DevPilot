import express from 'express'
import cors from 'cors'
import { errorHandler } from './middleware/error-handler.js'
import { notFoundHandler } from './middleware/not-found.js'
import { requestIdMiddleware } from './middleware/request-id.js'
import { authRouter } from './routes/auth.routes.js'
import { codeAnalysisRouter } from './routes/code-analysis.routes.js'
import { githubIntegrationRouter } from './routes/github-integration.routes.js'
import { healthRouter } from './routes/health.routes.js'
import { ragRouter } from './routes/rag.routes.js'

export const app = express()

app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
)

app.disable('x-powered-by')
app.use(requestIdMiddleware)
app.use(express.json({ limit: '100kb' }))
app.use('/api/v1', healthRouter)
app.use('/api/v1', authRouter)
app.use('/api/v1', githubIntegrationRouter)
app.use('/api/v1', codeAnalysisRouter)
app.use('/api/v1', ragRouter)
app.use(notFoundHandler)
app.use(errorHandler)