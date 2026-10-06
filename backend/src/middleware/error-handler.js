export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error)

  const parserErrors = {
    'entity.parse.failed': {
      statusCode: 400,
      code: 'INVALID_JSON',
      message: 'Request body must be valid JSON',
    },
    'entity.too.large': {
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body exceeds the allowed size',
    },
  }
  const parserError = parserErrors[error.type]
  const mongooseValidationError = error.name === 'ValidationError' || error.name === 'CastError'
  const statusCode = parserError?.statusCode ?? (mongooseValidationError
    ? 400
    : Number.isInteger(error.statusCode)
    && error.statusCode >= 400
    && error.statusCode < 600
    ? error.statusCode
    : 500)

  res.status(statusCode).json({
    error: {
      code: parserError?.code ?? (mongooseValidationError ? 'VALIDATION_ERROR' : statusCode === 500 ? 'INTERNAL_ERROR' : error.code ?? 'REQUEST_ERROR'),
      message: parserError?.message ?? (mongooseValidationError ? 'Submitted data is invalid' : statusCode === 500 ? 'An unexpected error occurred' : error.message),
      requestId: req.requestId,
    },
  })
}