export function getHealth(req, res) {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
  })
}