import { HttpError } from '../utils/http-error.js'

export function validateRagRepositoryId(value) {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) {
    throw new HttpError(400, 'INVALID_REPOSITORY_ID', 'Repository ID is invalid')
  }
  return value
}

export function validateRagQuestion(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => key !== 'question')) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Request body must contain only a question')
  }
  if (typeof body.question !== 'string' || !body.question.trim()) {
    throw new HttpError(400, 'RAG_QUESTION_REQUIRED', 'Enter a repository question')
  }
  if (body.question.trim().length > 4000) {
    throw new HttpError(400, 'RAG_QUESTION_TOO_LONG', 'Question cannot exceed 4,000 characters')
  }
  return body.question.trim()
}

export function validateRagIndexRequest(body) {
  if (body === undefined) return
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Index request does not accept client-supplied content or options')
  }
}