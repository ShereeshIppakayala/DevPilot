import axios from 'axios'
import { useCallback, useEffect, useState } from 'react'
import {
  analyzePublicRepositoryFile,
  analyzeRepositoryFile,
  askRepository,
  getPublicRepositoryFile,
  getPublicRepositoryTree,
  getRepositoryFile,
  getRagIndexStatus,
  getRepositoryTree,
  indexRepository,
  type CodeAnalysisResult,
  type CodeAnalysisTask,
  type GitHubRepository,
  type GitHubTextFile,
  type GitHubTreeEntry,
  type RagAnswer,
  type RagIndexStatus,
} from '../../api/github'

interface ApiError {
  error?: {
    code?: string
    message?: string
  }
}

interface TreeNode {
  name: string
  path: string
  children: TreeNode[]
  isFile: boolean
}

function errorMessage(error: unknown) {
  if (axios.isAxiosError<ApiError>(error)) {
    const code = error.response?.data.error?.code
    if (code === 'FILE_TOO_LARGE') return 'This file is larger than the 256 KiB preview limit.'
    if (code === 'FILE_NOT_TEXT') return 'This file is binary or cannot be displayed as text.'
    if (code === 'FILE_NOT_FOUND') return 'This file is no longer present on the selected branch. Reload the tree.'
    if (code === 'REPOSITORY_NOT_ACCESSIBLE') return 'Repository access changed. Refresh your repository list.'
    if (code === 'GITHUB_REAUTH_REQUIRED') return 'GitHub access expired. Reconnect your account and retry.'
    if (code === 'AI_NOT_CONFIGURED') return 'AI analysis is not configured on the backend. Add the server-side LLM_API_KEY and restart the API.'
    if (code === 'AI_RATE_LIMITED') return 'Gemini is rate limiting AI analysis. Check your Google AI Studio quota and retry later.'
    if (code === 'AI_REQUEST_RATE_LIMITED') return 'DevPilot reached its limit of 10 analysis requests per 15 minutes. Wait, then retry.'
    if (code === 'AI_TIMEOUT') return 'AI analysis took too long. Try again.'
    if (code === 'ANALYSIS_FILE_TOO_LARGE') return 'This file is over the 24 KiB AI analysis limit. Choose a smaller file.'
    if (code === 'RAG_INDEX_REQUIRED') return 'Build the repository index before asking questions.'
    if (code === 'RAG_INDEX_STALE') return 'The repository has changed since indexing. Rebuild the index before asking.'
    if (code === 'RAG_RATE_LIMITED') return 'DevPilot reached its limit of 12 repository indexing or question requests per 15 minutes. Wait, then retry.'
    if (code === 'AI_EMBEDDING_RESPONSE_INVALID') return 'The embedding service returned invalid data. Retry indexing.'
    return error.response?.data.error?.message ?? 'Could not load repository data.'
  }
  return 'Could not load repository data. Check the connection and try again.'
}

function buildTree(entries: GitHubTreeEntry[]): TreeNode[] {
  const roots: TreeNode[] = []
  const byPath = new Map<string, TreeNode>()

  for (const entry of entries) {
    const segments = entry.path.split('/')
    let parentPath = ''
    let siblings = roots

    segments.forEach((segment, index) => {
      const path = parentPath ? `${parentPath}/${segment}` : segment
      const isFile = index === segments.length - 1
      let node = byPath.get(path)
      if (!node) {
        node = { name: segment, path, children: [], isFile }
        byPath.set(path, node)
        siblings.push(node)
      }
      if (!isFile) siblings = node.children
      parentPath = path
    })
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.isFile !== right.isFile) return left.isFile ? 1 : -1
      return left.name.localeCompare(right.name)
    })
    nodes.forEach((node) => sortNodes(node.children))
  }
  sortNodes(roots)
  return roots
}

function getPublicRepositoryCoordinates(fullName: string): [string, string] {
  const [owner, name] = fullName.split('/', 2)
  if (!owner || !name) throw new Error('Public repository name is invalid')
  return [owner, name]
}

interface TreeBranchProps {
  nodes: TreeNode[]
  depth: number
  selectedPath: string | null
  onSelectFile: (path: string) => void
}

function TreeBranch({ nodes, depth, selectedPath, onSelectFile }: TreeBranchProps) {
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set(depth === 0 ? [''] : []))

  function toggle(path: string) {
    setOpenFolders((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <ul className="tree-branch">
      {nodes.map((node) => (
        <li key={node.path}>
          {node.isFile ? (
            <button
              className={`tree-item tree-file ${selectedPath === node.path ? 'tree-item-selected' : ''}`}
              style={{ '--tree-depth': depth } as React.CSSProperties}
              type="button"
              onClick={() => onSelectFile(node.path)}
              title={node.path}
            >
              <span className="tree-file-mark" aria-hidden="true">F</span>
              <span>{node.name}</span>
            </button>
          ) : (
            <>
              <button
                className="tree-item tree-folder"
                style={{ '--tree-depth': depth } as React.CSSProperties}
                type="button"
                aria-expanded={openFolders.has(node.path)}
                onClick={() => toggle(node.path)}
                title={node.path}
              >
                <span className="tree-chevron" aria-hidden="true">{openFolders.has(node.path) ? '▾' : '▸'}</span>
                <span>{node.name}</span>
              </button>
              {openFolders.has(node.path) && (
                <TreeBranch nodes={node.children} depth={depth + 1} selectedPath={selectedPath} onSelectFile={onSelectFile} />
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

interface RepositoryExplorerProps {
  repository: GitHubRepository
  onClose: () => void
}

export function RepositoryExplorer({ repository, onClose }: RepositoryExplorerProps) {
  const [entries, setEntries] = useState<GitHubTreeEntry[]>([])
  const [treeTruncated, setTreeTruncated] = useState(false)
  const [treeLoading, setTreeLoading] = useState(true)
  const [treeError, setTreeError] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [file, setFile] = useState<GitHubTextFile | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState('')
  const [analysisTask, setAnalysisTask] = useState<CodeAnalysisTask>('explain_file')
  const [analysisQuestion, setAnalysisQuestion] = useState('')
  const [analysis, setAnalysis] = useState<CodeAnalysisResult | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [ragIndex, setRagIndex] = useState<RagIndexStatus | null>(null)
  const [ragStatusLoading, setRagStatusLoading] = useState(true)
  const [ragIndexing, setRagIndexing] = useState(false)
  const [ragIndexError, setRagIndexError] = useState('')
  const [ragQuestion, setRagQuestion] = useState('')
  const [ragAsking, setRagAsking] = useState(false)
  const [ragAnswer, setRagAnswer] = useState<RagAnswer | null>(null)
  const [ragError, setRagError] = useState('')

  const loadTree = useCallback(async () => {
    setTreeLoading(true)
    setTreeError('')
    setSelectedPath(null)
    setFile(null)
    setFileError('')
    setAnalysis(null)
    setAnalysisError('')
    try {
      const tree = repository.isPublic
        ? await getPublicRepositoryTree(...getPublicRepositoryCoordinates(repository.fullName))
        : await getRepositoryTree(repository.id)
      setEntries(tree.entries)
      setTreeTruncated(tree.truncated)
    } catch (requestError) {
      setEntries([])
      setTreeError(errorMessage(requestError))
    } finally {
      setTreeLoading(false)
    }
  }, [repository.id, repository.fullName, repository.isPublic])

  useEffect(() => {
    void Promise.resolve().then(loadTree)
  }, [loadTree])

  const loadRagStatus = useCallback(async () => {
    if (repository.isPublic) {
      setRagIndex(null)
      setRagStatusLoading(false)
      return
    }
    setRagStatusLoading(true)
    setRagIndexError('')
    try {
      setRagIndex(await getRagIndexStatus(repository.id))
    } catch (requestError) {
      setRagIndex(null)
      setRagIndexError(errorMessage(requestError))
    } finally {
      setRagStatusLoading(false)
    }
  }, [repository.id, repository.isPublic])

  useEffect(() => {
    void Promise.resolve().then(loadRagStatus)
  }, [loadRagStatus])

  async function openFile(path: string) {
    setSelectedPath(path)
    setFile(null)
    setFileError('')
    setAnalysis(null)
    setAnalysisError('')
    setFileLoading(true)
    try {
      setFile(repository.isPublic
        ? await getPublicRepositoryFile(...getPublicRepositoryCoordinates(repository.fullName), path)
        : await getRepositoryFile(repository.id, path))
    } catch (requestError) {
      setFileError(errorMessage(requestError))
    } finally {
      setFileLoading(false)
    }
  }

  async function runAnalysis() {
    if (!file || !selectedPath) return
    setAnalysisLoading(true)
    setAnalysisError('')
    setAnalysis(null)
    try {
      const input = {
        filePath: selectedPath,
        task: analysisTask,
        question: analysisQuestion,
      }
      if (repository.isPublic) {
        const [owner, name] = getPublicRepositoryCoordinates(repository.fullName)
        setAnalysis(await analyzePublicRepositoryFile({ ...input, owner, name }))
      } else {
        setAnalysis(await analyzeRepositoryFile({ ...input, repositoryId: repository.id }))
      }
    } catch (requestError) {
      setAnalysisError(errorMessage(requestError))
    } finally {
      setAnalysisLoading(false)
    }
  }

  async function buildRepositoryIndex() {
    setRagIndexing(true)
    setRagIndexError('')
    setRagAnswer(null)
    setRagError('')
    try {
      setRagIndex(await indexRepository(repository.id))
    } catch (requestError) {
      setRagIndexError(errorMessage(requestError))
    } finally {
      setRagIndexing(false)
    }
  }

  async function submitRagQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setRagAsking(true)
    setRagError('')
    setRagAnswer(null)
    try {
      setRagAnswer(await askRepository(repository.id, ragQuestion))
    } catch (requestError) {
      setRagError(errorMessage(requestError))
    } finally {
      setRagAsking(false)
    }
  }

  const tree = buildTree(entries)

  return (
    <section className="explorer-panel" aria-label={`Files in ${repository.fullName}`}>
      <header className="explorer-header">
        <div className="explorer-heading-copy">
          <span className="eyebrow">{repository.isPublic ? 'PUBLIC REPOSITORY · READ ONLY' : 'REPOSITORY EXPLORER'}</span>
          <strong>{repository.fullName}</strong>
        </div>
        <button className="explorer-close" type="button" onClick={onClose} aria-label="Close repository explorer" title="Close explorer">×</button>
      </header>
      <div className="explorer-layout">
        <aside className="file-tree-panel" aria-label="Repository file tree">
          <div className="tree-toolbar">
            <span>FILES</span>
            <button type="button" onClick={() => void loadTree()} disabled={treeLoading} title="Reload file tree">↻</button>
          </div>
          {treeLoading ? (
            <div className="explorer-state" role="status">Loading file tree…</div>
          ) : treeError ? (
            <div className="explorer-state explorer-error" role="alert">
              <p>{treeError}</p>
              <button type="button" onClick={() => void loadTree()}>Retry</button>
            </div>
          ) : tree.length ? (
            <>
              {treeTruncated && <p className="tree-notice">Tree is large; showing the first 20,000 files.</p>}
              <div className="tree-scroll"><TreeBranch nodes={tree} depth={0} selectedPath={selectedPath} onSelectFile={(path) => void openFile(path)} /></div>
            </>
          ) : (
            <div className="explorer-state">This repository has no files on its default branch.</div>
          )}
        </aside>
        <section className="file-viewer" aria-label="File preview" aria-live="polite">
          {!selectedPath ? (
            <div className="viewer-placeholder"><span aria-hidden="true">{`</>`}</span><p>Select a file to preview its text.</p></div>
          ) : fileLoading ? (
            <div className="explorer-state" role="status">Loading {selectedPath}…</div>
          ) : fileError ? (
            <div className="explorer-state explorer-error" role="alert"><p>{fileError}</p></div>
          ) : file ? (
            <>
              <header className="file-header">
                <span title={file.path}>{file.path}</span>
                <small>{file.size.toLocaleString()} bytes · UTF-8</small>
              </header>
              <pre className="file-content" tabIndex={0}><code>{file.content}</code></pre>
              <section className="analysis-panel" aria-label="AI file analysis">
                <div className="analysis-heading">
                  <div>
                    <span className="eyebrow">AI CODE ANALYSIS</span>
                    <p>Analysis uses this file only. Review suggestions; nothing is executed.</p>
                  </div>
                </div>
                {file.size > 24 * 1024 ? (
                  <p className="analysis-limit">This file exceeds the 24 KiB AI input limit. The text preview remains available.</p>
                ) : (
                  <>
                    <label className="analysis-task-label">
                      <span>Analysis</span>
                      <select value={analysisTask} onChange={(event) => setAnalysisTask(event.target.value as CodeAnalysisTask)}>
                        <option value="explain_file">Explain this file</option>
                        <option value="explain_function">Explain a function</option>
                        <option value="ask_question">Ask a question</option>
                        <option value="identify_bugs">Identify potential bugs</option>
                        <option value="suggest_improvements">Suggest improvements</option>
                        <option value="generate_tests">Suggest test cases</option>
                      </select>
                    </label>
                    {analysisTask !== 'explain_file' && (
                      <label className="analysis-question-label">
                        <span>{analysisTask === 'explain_function'
                          ? 'Function or code region'
                          : analysisTask === 'ask_question' ? 'Your question' : 'Additional question (optional)'}</span>
                        <textarea
                          maxLength={2000}
                          required={analysisTask === 'explain_function' || analysisTask === 'ask_question'}
                          value={analysisQuestion}
                          onChange={(event) => setAnalysisQuestion(event.target.value)}
                          placeholder={analysisTask === 'explain_function'
                            ? 'For example: explain parseConfig'
                            : analysisTask === 'ask_question' ? 'Ask about the selected file'
                              : 'Add focus or constraints'}
                        />
                        <small>{analysisQuestion.length}/2000</small>
                      </label>
                    )}
                    <button
                      className="analysis-submit"
                      type="button"
                      disabled={analysisLoading
                        || ((analysisTask === 'explain_function' || analysisTask === 'ask_question') && !analysisQuestion.trim())}
                      onClick={() => void runAnalysis()}
                    >
                      {analysisLoading ? 'Analyzing…' : 'Analyze file'}
                    </button>
                  </>
                )}
                {analysisLoading && <p className="analysis-status" role="status">The model is reviewing the selected file…</p>}
                {analysisError && <p className="analysis-error" role="alert">{analysisError}</p>}
                {analysis && (
                  <div className="analysis-result">
                    <div className="analysis-result-title">AI response <span>Review before relying on suggestions</span></div>
                    <pre><code>{analysis.response}</code></pre>
                  </div>
                )}
              </section>
            </>
          ) : null}
        </section>
      </div>
      {!repository.isPublic && <section className="rag-panel" aria-labelledby="rag-title">
        <div className="rag-panel-heading">
          <div>
            <span className="eyebrow">RETRIEVAL-AUGMENTED QUESTIONS</span>
            <h3 id="rag-title">Ask this repository</h3>
          </div>
          <span className={`rag-status ${ragIndex?.current ? 'rag-status-ready' : ''}`}>
            {ragStatusLoading ? 'CHECKING INDEX' : ragIndex?.current ? `${ragIndex.chunkCount} CHUNKS` : ragIndex?.indexed ? 'REINDEX REQUIRED' : 'NOT INDEXED'}
          </span>
        </div>
        <div className="rag-index-row">
          <p>{ragIndex?.current
            ? `${ragIndex.indexedFileCount} files indexed${ragIndex.truncated ? '; repository limits reached' : ''}. Index commit ${ragIndex.commitSha?.slice(0, 8)}.`
            : 'Index safe text files to enable repository-wide questions. Credentials and generated/vendor folders are excluded.'}</p>
          <button type="button" className="rag-index-button" disabled={ragIndexing || ragStatusLoading} onClick={() => void buildRepositoryIndex()}>
            {ragIndexing ? 'Indexing…' : ragIndex?.indexed ? 'Refresh index' : 'Build index'}
          </button>
        </div>
        <p className="rag-privacy-note">Eligible source text is sent to Google Gemini to create embeddings; questions send only retrieved excerpts. Do not index code you are not authorized to share with your configured AI provider.</p>
        {ragIndexing && <p className="rag-progress" role="status">Fetching eligible files, splitting chunks, and creating embeddings… This can take a little while.</p>}
        {ragIndexError && <p className="rag-error" role="alert">{ragIndexError}</p>}
        {ragIndex?.truncated && <p className="rag-limit-notice">Index limits were reached. Answers may not include every repository file.</p>}
        <form className="rag-question-form" onSubmit={(event) => void submitRagQuestion(event)}>
          <label htmlFor="rag-question">Question</label>
          <textarea
            id="rag-question"
            maxLength={4000}
            value={ragQuestion}
            onChange={(event) => setRagQuestion(event.target.value)}
            placeholder="How is authentication handled across this project?"
            disabled={ragAsking}
          />
          <div className="rag-question-actions">
            <small>{ragQuestion.length}/4000</small>
            <button type="submit" className="rag-ask-button" disabled={!ragIndex?.current || !ragQuestion.trim() || ragAsking}>
              {ragAsking ? 'Searching and answering…' : 'Ask repository'}
            </button>
          </div>
        </form>
        {ragAsking && <p className="rag-progress" role="status">Finding relevant source chunks, then generating a grounded answer…</p>}
        {ragError && <p className="rag-error" role="alert">{ragError}</p>}
        {ragAnswer && (
          <div className="rag-answer">
            <div className="rag-answer-title">Answer <small>Grounded in retrieved repository excerpts</small></div>
            <pre><code>{ragAnswer.answer}</code></pre>
            <div className="rag-sources-title">Sources</div>
            <ul className="rag-sources">
              {ragAnswer.sources.map((source) => (
                <li key={`${source.path}:${source.startLine}-${source.endLine}`}>
                  <button type="button" onClick={() => void openFile(source.path)}>
                    {source.path}:L{source.startLine}-L{source.endLine}
                  </button>
                  <span>similarity {source.score.toFixed(2)}</span>
                </li>
              ))}
            </ul>
            {ragAnswer.indexTruncated && <p className="rag-limit-notice">The repository index was truncated; this answer may omit relevant files.</p>}
          </div>
        )}
      </section>}
    </section>
  )
}