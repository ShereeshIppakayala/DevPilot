import mongoose from 'mongoose'

const githubOAuthStateSchema = new mongoose.Schema({
  stateHash: {
    type: String,
    required: true,
    unique: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    expires: 0,
  },
}, { timestamps: true })

export const GitHubOAuthState = mongoose.models.GitHubOAuthState
  ?? mongoose.model('GitHubOAuthState', githubOAuthStateSchema)