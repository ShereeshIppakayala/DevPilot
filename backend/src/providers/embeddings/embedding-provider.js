export class EmbeddingProviderError extends Error {
  constructor(kind) {
    super('The embedding provider could not complete the request')
    this.name = 'EmbeddingProviderError'
    this.kind = kind
  }
}

export class EmbeddingProvider {
  async embedDocuments(_texts) {
    throw new Error('embedDocuments must be implemented by an embedding provider')
  }

  async embedQuery(_text) {
    throw new Error('embedQuery must be implemented by an embedding provider')
  }
}