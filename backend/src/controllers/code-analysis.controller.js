import {
  getGitHubRepositoryFile,
  getPublicGitHubRepositoryFile,
} from '../services/github-integration.service.js'
import { analyzeRepositoryFile } from '../services/code-analysis.service.js'
import {
  validateCodeAnalysisRequest,
  validatePublicCodeAnalysisRequest,
} from '../validators/code-analysis.validators.js'

export async function analyzeRepositoryFileController(req, res) {
  const input = validateCodeAnalysisRequest(req.body, req.params.repositoryId)
  const file = await getGitHubRepositoryFile(req.auth.userId, input.repositoryId, input.filePath)
  const result = await analyzeRepositoryFile({
    task: input.task,
    question: input.question,
    file,
  })
  res.status(200).json({ analysis: result })
}

export async function analyzePublicRepositoryFileController(req, res) {
  const input = validatePublicCodeAnalysisRequest(req.body, req.params.owner, req.params.repository)
  const file = await getPublicGitHubRepositoryFile(input.owner, input.name, input.filePath)
  const result = await analyzeRepositoryFile({
    task: input.task,
    question: input.question,
    file,
  })
  res.status(200).json({ analysis: result })
}