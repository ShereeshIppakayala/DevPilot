import mongoose from 'mongoose'

let connectionPromise

export function connectToDatabase(uri, { serverSelectionTimeoutMs = 5000 } = {}) {
  if (!uri) {
    return Promise.reject(new Error('MONGODB_URI is required to start the API'))
  }

  if (mongoose.connection.readyState === 1) {
    return Promise.resolve(mongoose.connection)
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(uri, {
      serverSelectionTimeoutMS: serverSelectionTimeoutMs,
    }).then(() => mongoose.connection).catch(async (error) => {
      connectionPromise = undefined
      await mongoose.disconnect()
      throw error
    })
  }

  return connectionPromise
}

export async function disconnectFromDatabase() {
  connectionPromise = undefined
  await mongoose.disconnect()
}