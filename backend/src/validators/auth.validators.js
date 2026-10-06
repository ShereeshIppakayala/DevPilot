import { HttpError } from '../utils/http-error.js'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const registrationFields = new Set(['email', 'password', 'displayName'])
const loginFields = new Set(['email', 'password'])

function validateFields(body, allowedFields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object')
  }

  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Request contains an unsupported field')
  }
}

function validateEmail(value) {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'A valid email and password are required')
  }

  const email = value.trim().toLowerCase()
  if (email.length > 254 || !emailPattern.test(email)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'A valid email and password are required')
  }

  return email
}

function validatePassword(value, { registration }) {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'A valid email and password are required')
  }

  const byteLength = Buffer.byteLength(value, 'utf8')
  if (byteLength > 72 || (registration && [...value].length < 12)) {
    const message = registration
      ? 'Password must be at least 12 characters and no more than 72 UTF-8 bytes'
      : 'Email or password is incorrect'
    throw new HttpError(registration ? 400 : 401, registration ? 'VALIDATION_ERROR' : 'INVALID_CREDENTIALS', message)
  }

  return value
}

export function validateRegistration(body) {
  validateFields(body, registrationFields)

  let displayName
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Display name must be a string')
    }
    displayName = body.displayName.trim()
    if (displayName.length > 80) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Display name cannot exceed 80 characters')
    }
  }

  return {
    email: validateEmail(body.email),
    password: validatePassword(body.password, { registration: true }),
    displayName,
  }
}

export function validateLogin(body) {
  validateFields(body, loginFields)
  return {
    email: validateEmail(body.email),
    password: validatePassword(body.password, { registration: false }),
  }
}