export function notFoundHandler(req, res, next) {
  const error = new Error(`Route ${req.method} ${req.path} was not found`)
  error.statusCode = 404
  error.code = 'ROUTE_NOT_FOUND'
  next(error)
}