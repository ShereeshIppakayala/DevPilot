import { answerRepositoryQuestion, getRepositoryRagStatus, indexGitHubRepository } from '../services/rag.service.js'
import { validateRagIndexRequest, validateRagQuestion, validateRagRepositoryId } from '../validators/rag.validators.js'

export async function getRagStatus(req, res) {
  const repositoryId = validateRagRepositoryId(req.params.repositoryId)
  const status = await getRepositoryRagStatus(req.auth.userId, repositoryId)
  res.status(200).json({ index: status })
}

export async function indexRepository(req, res) {
  const repositoryId = validateRagRepositoryId(req.params.repositoryId)
  validateRagIndexRequest(req.body)
  const index = await indexGitHubRepository(req.auth.userId, repositoryId)
  res.status(200).json({ index })
}

export async function askRepository(req, res) {
  const repositoryId = validateRagRepositoryId(req.params.repositoryId)
  const question = validateRagQuestion(req.body)
  const result = await answerRepositoryQuestion(req.auth.userId, repositoryId, question)
  res.status(200).json({ result })
}