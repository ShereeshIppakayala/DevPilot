import mongoose from 'mongoose'

const encryptedTokenSchema = new mongoose.Schema({
  ciphertext: { type: String, required: true },
  iv: { type: String, required: true },
  authTag: { type: String, required: true },
}, { _id: false })

const githubConnectionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  githubUserId: { type: Number, required: true },
  githubLogin: { type: String, required: true, trim: true },
  accessToken: { type: encryptedTokenSchema, required: true, select: false },
  refreshToken: { type: encryptedTokenSchema, select: false, default: undefined },
  accessTokenExpiresAt: { type: Date, default: null },
  refreshTokenExpiresAt: { type: Date, default: null },
  status: {
    type: String,
    enum: ['connected', 'reconnect_required'],
    default: 'connected',
    required: true,
  },
  connectedAt: { type: Date, required: true },
}, {
  timestamps: true,
  strict: 'throw',
})

export const GitHubConnection = mongoose.models.GitHubConnection
  ?? mongoose.model('GitHubConnection', githubConnectionSchema)