import { GoogleGenAI } from '@google/genai'
import { config } from '../../config/env.js'

export class LlmProviderError extends Error {
  constructor(kind) {
    super('The AI provider could not complete the request')
    this.name = 'LlmProviderError'
    this.kind = kind
  }
}

function classifyGeminiError(error) {
  const status = Number(error?.status ?? error?.code)
  if (status === 400 || status === 413) return 'invalid_request'
  if (status === 401 || status === 403 || status === 404) return 'provider_configuration'
  if (status === 408 || status === 504 || /timeout|timed out|abort/i.test(error?.name ?? '')) return 'timeout'
  if (status === 429 || status === 503) return 'rate_limited'
  if (status >= 500) return 'provider_failure'
  if (/timeout|timed out|abort/i.test(error?.message ?? '')) return 'timeout'
  return 'provider_failure'
}

export class GeminiAdapter {
  constructor({
    apiKey = config.llmApiKey,
    model = config.llmModel,
    clientFactory = (key) => new GoogleGenAI({
      apiKey: key,
      httpOptions: { timeout: 25000 },
    }),
  } = {}) {
    this.apiKey = apiKey
    this.model = model
    this.clientFactory = clientFactory
  }

  async generateText({ systemPrompt, userPrompt, maxOutputTokens }) {
    if (!this.apiKey) throw new LlmProviderError('not_configured')

    try {
      const client = this.clientFactory(this.apiKey)
      const response = await client.models.generateContent({
        model: this.model,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens,
          temperature: 0.2,
        },
      })
      const text = response?.text
      if (typeof text !== 'string' || !text.trim()) throw new LlmProviderError('empty_response')
      return { text: text.trim() }
    } catch (error) {
      if (error instanceof LlmProviderError) throw error
      throw new LlmProviderError(classifyGeminiError(error))
    }
  }
}

