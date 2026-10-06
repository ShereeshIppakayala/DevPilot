import { GoogleGenAI } from '@google/genai'
import { config } from '../../config/env.js'
import { EmbeddingProviderError } from './embedding-provider.js'

const embeddingModel = 'gemini-embedding-001'
const embeddingDimensions = 768

function classifyError(error) {
  const status = Number(error?.status ?? error?.code)
  if (status === 400) return 'invalid_request'
  if (status === 401 || status === 403 || status === 404) return 'provider_configuration'
  if (status === 408 || status === 504 || /timeout|timed out|abort/i.test(String(error?.name))) return 'timeout'
  if (status === 429 || status === 503) return 'rate_limited'
  return 'provider_failure'
}

export class GeminiEmbeddingAdapter {
  constructor({ apiKey = config.llmApiKey, clientFactory = (key) => new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 25000 } }) } = {}) {
    this.apiKey = apiKey
    this.clientFactory = clientFactory
  }

  async #embed(texts, taskType) {
    if (!this.apiKey) throw new EmbeddingProviderError('not_configured')
    if (!Array.isArray(texts) || texts.length === 0) return []

    try {
      const client = this.clientFactory(this.apiKey)
      const response = await client.models.embedContent({
        model: embeddingModel,
        contents: texts,
        config: {
          taskType,
          outputDimensionality: embeddingDimensions,
        },
      })
      const vectors = response?.embeddings?.map((embedding) => embedding.values)
      if (!Array.isArray(vectors) || vectors.length !== texts.length
        || vectors.some((vector) => !Array.isArray(vector) || vector.length !== embeddingDimensions
          || vector.some((value) => !Number.isFinite(value)))) {
        throw new EmbeddingProviderError('invalid_response')
      }
      return vectors
    } catch (error) {
      if (error instanceof EmbeddingProviderError) throw error
      throw new EmbeddingProviderError(classifyError(error))
    }
  }

  embedDocuments(texts) {
    return this.#embed(texts, 'RETRIEVAL_DOCUMENT')
  }

  async embedQuery(text) {
    const [vector] = await this.#embed([text], 'CODE_RETRIEVAL_QUERY')
    return vector
  }
}

export { embeddingDimensions, embeddingModel }