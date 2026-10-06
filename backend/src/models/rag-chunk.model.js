import mongoose from 'mongoose'

const ragChunkSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  repositoryId: { type: Number, required: true },
  commitSha: { type: String, required: true },
  path: { type: String, required: true },
  chunkIndex: { type: Number, required: true, min: 0 },
  startLine: { type: Number, required: true, min: 1 },
  endLine: { type: Number, required: true, min: 1 },
  content: { type: String, required: true, maxlength: 6000 },
  embedding: {
    type: [Number],
    required: true,
    select: false,
    validate: {
      validator: (values) => values.length === 768 && values.every(Number.isFinite),
      message: 'Embedding must contain 768 finite dimensions',
    },
  },
  contentHash: { type: String, required: true },
}, { timestamps: true, strict: 'throw' })

ragChunkSchema.index(
  { userId: 1, repositoryId: 1, commitSha: 1, path: 1, chunkIndex: 1 },
  { unique: true, name: 'uniq_rag_chunk_location' },
)
ragChunkSchema.index({ userId: 1, repositoryId: 1, commitSha: 1 }, { name: 'rag_repository_chunks' })

export const RagChunk = mongoose.models.RagChunk ?? mongoose.model('RagChunk', ragChunkSchema)