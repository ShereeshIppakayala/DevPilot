import { apiClient } from './client'

export interface GitHubConnection {
  connected: boolean
  status?: 'connected' | 'reconnect_required'
  githubLogin?: string
  connectedAt?: string
  installationUrl?: string
}

export interface GitHubRepository {
  id: number
  name: string
  fullName: string
  private: boolean
  url: string
  defaultBranch: string
  isPublic?: boolean
}

export interface GitHubTreeEntry {
  path: string
  size: number
}

export interface GitHubRepositoryTree {
  repository: Pick<GitHubRepository, 'id' | 'fullName' | 'defaultBranch'>
  entries: GitHubTreeEntry[]
  truncated: boolean
  commitSha: string
}

export interface GitHubTextFile {
  path: string
  size: number
  content: string
  encoding: 'utf-8'
}

export type CodeAnalysisTask =
  | 'explain_file'
  | 'explain_function'
  | 'ask_question'
  | 'identify_bugs'
  | 'suggest_improvements'
  | 'generate_tests'

export interface CodeAnalysisResult {
  task: CodeAnalysisTask
  filePath: string
  response: string
}

export interface RagIndexStatus {
  indexed: boolean
  current: boolean
  commitSha?: string
  chunkCount?: number
  indexedFileCount?: number
  skippedFileCount?: number
  truncated?: boolean
  indexedAt?: string
}

export interface RagSource {
  path: string
  startLine: number
  endLine: number
  score: number
}

export interface RagAnswer {
  answer: string
  sources: RagSource[]
  commitSha: string
  indexTruncated: boolean
}

export async function startGitHubConnection(): Promise<{ authorizationUrl: string }> {
  const response = await apiClient.post<{ authorizationUrl: string }>('/integrations/github/connect')
  return response.data
}

export async function getGitHubConnection(): Promise<GitHubConnection> {
  const response = await apiClient.get<{ connection: GitHubConnection }>('/integrations/github/connection')
  return response.data.connection
}

export async function listGitHubRepositories(): Promise<GitHubRepository[]> {
  const response = await apiClient.get<{ repositories: GitHubRepository[] }>('/integrations/github/repositories')
  return response.data.repositories
}

export async function findPublicGitHubRepository(owner: string, name: string): Promise<GitHubRepository> {
  const response = await apiClient.get<{ repository: GitHubRepository }>(
    `/integrations/github/public-repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
  )
  return { ...response.data.repository, isPublic: true }
}

export async function disconnectGitHub(): Promise<void> {
  await apiClient.delete('/integrations/github/connection')
}

export async function getRepositoryTree(repositoryId: number): Promise<GitHubRepositoryTree> {
  const response = await apiClient.get<GitHubRepositoryTree>(
    `/integrations/github/repositories/${repositoryId}/tree`,
  )
  return response.data
}

export async function getPublicRepositoryTree(owner: string, name: string): Promise<GitHubRepositoryTree> {
  const response = await apiClient.get<GitHubRepositoryTree>(
    `/integrations/github/public-repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tree`,
  )
  return response.data
}

export async function getRepositoryFile(repositoryId: number, path: string): Promise<GitHubTextFile> {
  const response = await apiClient.get<{ file: GitHubTextFile }>(
    `/integrations/github/repositories/${repositoryId}/file`,
    { params: { path } },
  )
  return response.data.file
}

export async function getPublicRepositoryFile(owner: string, name: string, path: string): Promise<GitHubTextFile> {
  const response = await apiClient.get<{ file: GitHubTextFile }>(
    `/integrations/github/public-repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/file`,
    { params: { path } },
  )
  return response.data.file
}

export async function analyzeRepositoryFile(input: {
  repositoryId: number
  filePath: string
  task: CodeAnalysisTask
  question?: string
}): Promise<CodeAnalysisResult> {
  const { repositoryId, ...body } = input
  const response = await apiClient.post<{ analysis: CodeAnalysisResult }>(
    `/integrations/github/repositories/${repositoryId}/analyze`,
    body,
    { timeout: 35000 },
  )
  return response.data.analysis
}

export async function analyzePublicRepositoryFile(input: {
  owner: string
  name: string
  filePath: string
  task: CodeAnalysisTask
  question?: string
}): Promise<CodeAnalysisResult> {
  const { owner, name, ...body } = input
  const response = await apiClient.post<{ analysis: CodeAnalysisResult }>(
    `/integrations/github/public-repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/analyze`,
    body,
    { timeout: 35000 },
  )
  return response.data.analysis
}

export async function getRagIndexStatus(repositoryId: number): Promise<RagIndexStatus> {
  const response = await apiClient.get<{ index: RagIndexStatus }>(
    `/integrations/github/repositories/${repositoryId}/rag`,
  )
  return response.data.index
}

export async function indexRepository(repositoryId: number): Promise<RagIndexStatus> {
  const response = await apiClient.post<{ index: RagIndexStatus }>(
    `/integrations/github/repositories/${repositoryId}/rag/index`,
    {},
    { timeout: 180000 },
  )
  return response.data.index
}

export async function askRepository(repositoryId: number, question: string): Promise<RagAnswer> {
  const response = await apiClient.post<{ result: RagAnswer }>(
    `/integrations/github/repositories/${repositoryId}/rag/ask`,
    { question },
    { timeout: 45000 },
  )
  return response.data.result
}