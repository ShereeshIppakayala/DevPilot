import mongoose from 'mongoose'

const ragIndexSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  repositoryId: { type: Number, required: true },
  repositoryFullName: { type: String, required: true },
  commitSha: { type: String, required: true },
  embeddingModel: { type: String, required: true },
  chunkCount: { type: Number, required: true, min: 0 },
  indexedFileCount: { type: Number, required: true, min: 0 },
  skippedFileCount: { type: Number, required: true, min: 0 },
  truncated: { type: Boolean, default: false },
  indexedAt: { type: Date, required: true },
}, { timestamps: true, strict: 'throw' })

ragIndexSchema.index({ userId: 1, repositoryId: 1 }, { unique: true, name: 'uniq_rag_user_repository' })

export const RagIndex = mongoose.models.RagIndex ?? mongoose.model('RagIndex', ragIndexSchema)