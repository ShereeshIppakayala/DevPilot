import { HttpError } from '../utils/http-error.js'

const allowedFields = new Set(['filePath', 'task', 'question'])
const supportedTasks = new Set([
  'explain_file',
  'explain_function',
  'ask_question',
  'identify_bugs',
  'suggest_improvements',
  'generate_tests',
])

function validateAnalysisBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object')
  }
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Request contains an unsupported field')
  }
  if (typeof body.filePath !== 'string' || body.filePath.length < 1 || body.filePath.length > 1024) {
    throw new HttpError(400, 'INVALID_FILE_PATH', 'File path is invalid')
  }
  if (typeof body.task !== 'string' || !supportedTasks.has(body.task)) {
    throw new HttpError(400, 'INVALID_ANALYSIS_TASK', 'Choose a supported code analysis task')
  }
  if (body.question !== undefined && typeof body.question !== 'string') {
    throw new HttpError(400, 'INVALID_ANALYSIS_QUESTION', 'Question must be text')
  }
  const question = body.question?.trim() ?? ''
  if (question.length > 2000) {
    throw new HttpError(400, 'ANALYSIS_QUESTION_TOO_LONG', 'Question cannot exceed 2,000 characters')
  }
  if (['explain_function', 'ask_question'].includes(body.task) && !question) {
    throw new HttpError(400, 'ANALYSIS_QUESTION_REQUIRED', 'Enter a question or code region to analyze')
  }

  return {
    filePath: body.filePath,
    task: body.task,
    question,
  }
}

export function validateCodeAnalysisRequest(body, repositoryId) {
  if (typeof repositoryId !== 'string' || !/^\d{1,20}$/.test(repositoryId)) {
    throw new HttpError(400, 'INVALID_REPOSITORY_ID', 'Repository ID is invalid')
  }
  return { repositoryId, ...validateAnalysisBody(body) }
}

export function validatePublicCodeAnalysisRequest(body, owner, name) {
  if (typeof owner !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner)
    || typeof name !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(name)
    || name === '.' || name === '..') {
    throw new HttpError(400, 'INVALID_REPOSITORY_NAME', 'Enter a valid GitHub owner and repository name')
  }
  return { owner, name, ...validateAnalysisBody(body) }
}