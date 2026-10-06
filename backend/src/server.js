import { app } from './app.js'
import { connectToDatabase, disconnectFromDatabase } from './config/database.js'
import { assertAuthConfiguration, config } from './config/env.js'

async function startServer() {
  try {
    assertAuthConfiguration()
    await connectToDatabase(config.mongodbUri, {
      serverSelectionTimeoutMs: config.mongodbServerSelectionTimeoutMs,
    })
  } catch (error) {
    console.error(`API startup failed:` , error)
    process.exitCode = 1
    return
  }

  const server = app.listen(config.port, config.host, () => {
    console.info(`DevPilot API listening at http://${config.host}:${config.port}`)
  })

  server.on('error', async (error) => {
    console.error(`DevPilot API failed to start (${error.code ?? error.name}).`)
    await disconnectFromDatabase()
    process.exitCode = 1
  })

  async function shutdown(signal) {
    console.info(`${signal} received; closing DevPilot API.`)
    server.close(async (error) => {
      if (error) console.error('Error while closing the HTTP server.')
      await disconnectFromDatabase()
      process.exitCode = error ? 1 : 0
    })
  }

  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
}

void startServer()