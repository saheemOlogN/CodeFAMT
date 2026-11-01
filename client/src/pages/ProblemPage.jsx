import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, CheckCircle2, Clock3, Copy, History, LoaderCircle, Play, RefreshCw, RotateCcw, Send, Terminal, XCircle } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../context/auth'
import { useRealtime } from '../context/RealtimeProvider'
import { useApi } from '../hooks/useApi'
import CodeEditor from '../components/CodeEditor'
import './Workspace.css'

export const LANGUAGES = [
  { id: 'cpp', label: 'C++', filename: 'main.cpp' },
  { id: 'python', label: 'Python', filename: 'main.py' },
  { id: 'java', label: 'Java', filename: 'Main.java' },
  { id: 'javascript', label: 'JavaScript', filename: 'main.js' },
  { id: 'c', label: 'C', filename: 'main.c' },
]

export function pending(status) {
  return status === 'queued' || status === 'running'
}

export function statusLabel(status) {
  return (status || 'pending').split('_').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
}

export function Verdict({ status }) {
  const active = pending(status)
  const good = status === 'accepted' || status === 'completed'
  const Icon = active ? LoaderCircle : good ? CheckCircle2 : XCircle
  return <span className={`submission-verdict ${active ? 'submission-pending' : good ? 'submission-accepted' : 'submission-failed'}`}><Icon size={14} className={active ? 'workspace-spin' : ''} />{statusLabel(status)}</span>
}

export function useTrackedRecord(record, setRecord, type) {
  const { token } = useAuth()
  const socket = useRealtime()
  const [error, setError] = useState('')
  const id = record?._id
  const active = pending(record?.status)

  useEffect(() => {
    if (!id) return
    let disposed = false
    let fetching = false
    const controller = new AbortController()
    async function refresh() {
      if (fetching) return
      fetching = true
      try {
        const data = await api(type === 'run' ? `/submissions/runs/${id}` : `/submissions/${id}`, { token, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) })
        if (!disposed) {
          setRecord(data[type])
          setError('')
        }
      } catch (failure) {
        if (!disposed && failure.name !== 'AbortError') setError(failure.message)
      } finally {
        fetching = false
      }
    }
    function updated(payload) {
      if (payload[type]?._id === id) refresh()
    }
    if (active) refresh()
    const timer = active ? setInterval(refresh, 3000) : null
    socket?.on(`${type}:updated`, updated)
    socket?.on('connect', refresh)
    return () => {
      disposed = true
      controller.abort()
      clearInterval(timer)
      socket?.off(`${type}:updated`, updated)
      socket?.off('connect', refresh)
    }
  }, [id, active, type, token, socket, setRecord])
  return error
}

function readDraft(key, language, starter = '') {
  try { return localStorage.getItem(`${key}:${language}`) ?? starter }
  catch { return starter }
}

export default function ProblemPage() {
  const { problemId, contestId } = useParams()
  const { user } = useAuth()
  return <ProblemWorkspace key={`${user.id}:${contestId || 'practice'}:${problemId}`} problemId={problemId} contestId={contestId} />
}

function ProblemWorkspace({ problemId, contestId }) {
  const { user, token, refreshUser } = useAuth()
  const path = contestId ? `/contests/${contestId}/problems/${problemId}` : `/problems/${problemId}`
  const { data, loading, error, reload } = useApi(path)
  const draftKey = `codefamt-draft:${user.id}:${contestId || 'practice'}:${problemId}`
  const mode = 'dsa'
  const [language, setLanguage] = useState('cpp')
  const [code, setCode] = useState('')
  const [selectedExample, setSelectedExample] = useState(0)
  const [tab, setTab] = useState('input')
  const [run, setRun] = useState(null)
  const [submission, setSubmission] = useState(null)
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')
  const [storageError, setStorageError] = useState(false)
  const [copied, setCopied] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [now, setNow] = useState(Date.now)
  const serverClock = useRef({ server: now, client: now })
  const refreshedSubmission = useRef(null)
  const mounted = useRef(true)
  const runError = useTrackedRecord(run, setRun, 'run')
  const submissionError = useTrackedRecord(submission, setSubmission, 'submission')

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (data?.serverNow) {
      serverClock.current = { server: new Date(data.serverNow).getTime(), client: Date.now() }
      setNow(serverClock.current.server)
    }
  }, [data?.serverNow])

  useEffect(() => {
    if (!contestId) return
    const timer = setInterval(() => setNow(serverClock.current.server + Date.now() - serverClock.current.client), 1000)
    return () => clearInterval(timer)
  }, [contestId])

  useEffect(() => {
    if (submission?.status === 'accepted' && refreshedSubmission.current !== submission._id) {
      refreshedSubmission.current = submission._id
      refreshUser(true)
    }
  }, [submission, refreshUser])

  const dsaConfigs = data?.problem?.dsa || []
  const modeDraftKey = `${draftKey}:dsa`
  const starterFor = lang => dsaConfigs.find(item => item.language === lang)?.starter || ''
  const executionPending = Boolean(busy) || pending(run?.status) || pending(submission?.status)
  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current || !data?.problem?.dsa?.length) return
    initialized.current = true
    const config = data.problem.dsa.find(item => item.language === 'cpp') || data.problem.dsa[0]
    setLanguage(config.language)
    setCode(readDraft(`${draftKey}:dsa`, config.language, config.starter))
  }, [data, draftKey])

  function updateCode(value) {
    setCode(value)
    try {
      localStorage.setItem(`${modeDraftKey}:${language}`, value)
      setStorageError(false)
    } catch { setStorageError(true) }
  }

  function changeLanguage(value) {
    setLanguage(value)
    setCode(readDraft(modeDraftKey, value, starterFor(value)))
    setResetting(false)
  }

  async function execute(kind) {
    setActionError('')
    const encoder = new TextEncoder()
    if (!code.trim() || code.includes('\0') || encoder.encode(code).length > 50000) {
      setActionError('Enter a solution of up to 50,000 bytes without NUL characters.')
      return
    }
    setBusy(kind)
    try {
      const body = kind === 'run' ? { language, code, runExamples: true } : { problemId, language, code, ...(contestId ? { contestId } : {}) }
      if (mode === 'dsa') Object.assign(body, { mode, problemId, ...(contestId ? { contestId } : {}) })
      const result = await api(kind === 'run' ? '/submissions/run' : '/submissions', { method: 'POST', body, token })
      if (!mounted.current) return
      if (kind === 'run') setRun(result.run)
      else setSubmission(result.submission)
      setTab(kind === 'run' ? 'output' : 'verdict')
    } catch (failure) {
      if (mounted.current) setActionError(failure.message)
    } finally {
      if (mounted.current) setBusy('')
    }
  }

  async function retry() {
    setBusy('retry')
    setActionError('')
    try {
      const result = await api(`/submissions/${submission._id}/retry`, { method: 'POST', body: {}, token })
      if (mounted.current) setSubmission(result.submission)
    } catch (failure) {
      if (mounted.current) setActionError(failure.message)
    } finally {
      if (mounted.current) setBusy('')
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => { if (mounted.current) setCopied(false) }, 1800)
    } catch { setActionError('The clipboard is unavailable. Select the code to copy it.') }
  }

  const problem = data?.problem
  const contestActive = !contestId || (data && now >= new Date(data.startTime).getTime() && now < new Date(data.endTime).getTime())
  const timeLeft = data?.endTime ? Math.max(0, Math.floor((new Date(data.endTime).getTime() - now) / 1000)) : 0
  const timerLabel = `${String(Math.floor(timeLeft / 3600)).padStart(2, '0')}:${String(Math.floor(timeLeft % 3600 / 60)).padStart(2, '0')}:${String(timeLeft % 60).padStart(2, '0')}`
  const backTo = contestId ? `/contests/${contestId}` : '/problems'

  if (loading && !problem) return <div className="workspace-state"><LoaderCircle className="workspace-spin" size={24} /><p>Loading problem...</p></div>
  if (error && !problem) return <div className="workspace-state"><XCircle size={26} /><h1>Problem unavailable</h1><p role="alert">{error}</p><button className="workspace-button" onClick={reload}><RefreshCw size={16} />Try again</button><Link to={backTo}>Back to {contestId ? 'contest' : 'problems'}</Link></div>
  if (!problem) return null

  return (
    <div className="workspace-page">
      <div className="workspace-breadcrumb">
        <Link to={backTo}><ArrowLeft size={15} />{contestId ? 'Contest' : 'Problem library'}</Link>
        <span className="workspace-breadcrumb-divider">/</span><span>{problem.title}</span>
        {contestId && <span className={`workspace-timer ${!contestActive ? 'workspace-muted' : ''}`}><Clock3 size={14} />{contestActive ? timerLabel : now < new Date(data.startTime).getTime() ? 'Not started' : 'Contest ended'}</span>}
      </div>
      <div className="workspace-grid">
        <section className="workspace-statement">
          <div className="workspace-panel-heading"><span>Description</span><Link to={`/submissions?problemId=${problemId}${contestId ? `&contestId=${contestId}` : ''}`}><History size={15} />Submissions</Link></div>
          <div className="workspace-statement-body">
            <div className="workspace-title-line"><h1>{problem.title}</h1></div>
            <div className="workspace-metadata"><span className={`workspace-difficulty workspace-${problem.difficulty}`}>{statusLabel(problem.difficulty)}</span><span><Clock3 size={13} />{problem.timeLimitMs} ms</span><span>{problem.memoryLimitMb} MB</span>{data.points !== undefined && <span>{data.points} points</span>}</div>
            <p className="workspace-prose">{problem.statement}</p>
            {problem.examples?.map((example, index) => <section className="workspace-section" key={index}><h2>Example {index + 1}</h2><div className="workspace-example"><div><span>Input</span><pre>{example.displayInput || example.input || '(empty)'}</pre></div><div><span>Output</span><pre>{example.output || '(empty)'}</pre></div></div>{example.explanation && <p className="workspace-explanation">{example.explanation}</p>}<button className="workspace-text-button" onClick={() => { setSelectedExample(index); setTab('input') }}><Play size={12} />View testcase</button></section>)}
            <section className="workspace-section"><h2>Constraints</h2><p className="workspace-prose workspace-constraints">{problem.constraints}</p></section>
            {problem.tags?.length > 0 && <div className="workspace-tags">{problem.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
          </div>
        </section>
        <section className="workspace-coding" aria-label="Solution workspace">
          <div className="workspace-panel-heading"><span>Code</span>{storageError && <span className="workspace-save-state" role="alert">Draft not saved</span>}</div>
          <div className="editor-toolbar">
            <select aria-label="Programming language" disabled={executionPending} value={language} onChange={event => changeLanguage(event.target.value)}>{LANGUAGES.filter(item => dsaConfigs.some(config => config.language === item.id)).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
            <div className="editor-actions"><button className="workspace-icon-button" title="Copy code" aria-label="Copy code" onClick={copyCode}>{copied ? <Check size={16} /> : <Copy size={16} />}</button><button className="workspace-icon-button" title="Reset code" aria-label="Reset code" onClick={() => setResetting(!resetting)}><RotateCcw size={16} /></button></div>
          </div>
          <p className="workspace-mode-help">{dsaConfigs.length ? 'Complete the function. Input and output are handled for you.' : 'The problem author needs to configure a function template before this problem can be solved.'}</p>
          {resetting && <div className="workspace-reset"><span>Reset this language's draft?</span><button onClick={() => { updateCode(starterFor(language)); setResetting(false) }}>Reset</button><button onClick={() => setResetting(false)}>Cancel</button></div>}
          <CodeEditor value={code} onChange={updateCode} language={language} />
          <div className="workspace-console">
            <div className="workspace-console-tabs" role="tablist" aria-label="Execution panels">
              <button role="tab" aria-selected={tab === 'input'} aria-controls="workspace-input" id="workspace-input-tab" onClick={() => setTab('input')}><Terminal size={14} />Testcases</button>
              <button role="tab" aria-selected={tab === 'output'} aria-controls="workspace-output" id="workspace-output-tab" onClick={() => setTab('output')}>Test result{pending(run?.status) && <LoaderCircle size={12} className="workspace-spin" />}</button>
              <button role="tab" aria-selected={tab === 'verdict'} aria-controls="workspace-verdict" id="workspace-verdict-tab" onClick={() => setTab('verdict')}>Verdict{pending(submission?.status) && <LoaderCircle size={12} className="workspace-spin" />}</button>
            </div>
            {tab === 'input' && <div className="workspace-console-body" role="tabpanel" id="workspace-input" aria-labelledby="workspace-input-tab">{problem.examples?.length ? <><div className="example-tabs" role="tablist" aria-label="Example testcases">{problem.examples.map((example, index) => <button key={index} role="tab" aria-selected={selectedExample === index} onClick={() => setSelectedExample(index)}>Case {index + 1}</button>)}</div><p className="workspace-muted">Run checks all {problem.examples.length} example testcases.</p><div className="workspace-example"><div><span>Input</span><pre>{problem.examples[selectedExample]?.displayInput || problem.examples[selectedExample]?.input || '(empty)'}</pre></div><div><span>Expected</span><pre>{problem.examples[selectedExample]?.output || '(empty)'}</pre></div></div></> : <p className="workspace-muted">The author has not added example testcases yet.</p>}</div>}
            {tab === 'output' && <div className="workspace-console-body" role="tabpanel" id="workspace-output" aria-labelledby="workspace-output-tab"><RunResult run={run} />{runError && <p className="workspace-error" role="alert">{runError}</p>}</div>}
            {tab === 'verdict' && <div className="workspace-console-body" role="tabpanel" id="workspace-verdict" aria-labelledby="workspace-verdict-tab">{submission ? <><div className="workspace-result-heading"><Verdict status={submission.status} /><Link to={`/submissions/${submission._id}`}>View submission</Link></div><div className="workspace-result-metrics"><span>{submission.passedTests} / {submission.totalTests} tests passed</span>{submission.executionTimeMs != null && <span>{submission.executionTimeMs} ms</span>}{submission.memoryUsedMb != null && <span>{submission.memoryUsedMb.toFixed(2)} MB</span>}</div>{pending(submission.status) && <p className="workspace-muted">{submission.status === 'queued' ? 'Waiting for the judge...' : 'Judging your solution...'}</p>}{submission.errorMessage && <p className="workspace-error">{submission.errorMessage}</p>}{submission.status === 'internal_error' && <button className="workspace-button" onClick={retry} disabled={Boolean(busy)}><RefreshCw size={14} />Retry judging</button>}</> : <p className="workspace-muted">No submission yet.</p>}{submissionError && <p className="workspace-error" role="alert">{submissionError}</p>}</div>}
          </div>
          {actionError && <p className="workspace-action-error" role="alert">{actionError}</p>}
          <div className="workspace-action-bar">{contestId && !contestActive && <span className="workspace-muted">Submissions are closed</span>}<button className="workspace-button" onClick={() => execute('run')} disabled={!dsaConfigs.length || !problem.examples?.length || executionPending}>{busy === 'run' || pending(run?.status) ? <LoaderCircle size={15} className="workspace-spin" /> : <Play size={15} />}Run</button><button className="workspace-button workspace-primary" onClick={() => execute('submit')} disabled={!dsaConfigs.length || executionPending || !contestActive}>{busy === 'submit' || pending(submission?.status) ? <LoaderCircle size={15} className="workspace-spin" /> : <Send size={15} />}Submit</button></div>
        </section>
      </div>
    </div>
  )
}

function RunResult({ run }) {
  if (!run) return <p className="workspace-muted">No output yet.</p>
  if (pending(run.status)) return <div className="workspace-run-pending"><Verdict status={run.status} /><p className="workspace-muted">{run.status === 'queued' ? 'Waiting for an execution slot...' : 'Running your program...'}</p></div>
  if (run.status === 'internal_error') return <p className="workspace-error">{run.errorMessage || 'Execution is unavailable. Run your code again to retry.'}</p>
  const result = run.result
  if (!result) return <p className="workspace-muted">Loading output...</p>
  if (result.cases) return <><div className="workspace-result-heading"><strong className={result.passedTests === result.totalTests ? 'submission-accepted' : 'workspace-error'}>{result.passedTests === result.totalTests ? 'All examples passed' : 'Some examples failed'}</strong><span>{result.passedTests} / {result.totalTests}</span></div>{result.cases.map((item, index) => <section className="example-result" key={index}><div className="workspace-result-heading"><strong>Case {index + 1}</strong><Verdict status={item.status} /></div><div className="workspace-example"><div><span>Input</span><pre>{item.input || '(empty)'}</pre></div><div><span>Your output</span><pre>{item.stdout || '(empty)'}</pre></div><div><span>Expected</span><pre>{item.expectedOutput || '(empty)'}</pre></div></div>{item.stderr && <pre className="workspace-output workspace-error">{item.stderr}</pre>}</section>)}</>

  return <><div className="workspace-result-heading"><span className={result.exception ? 'workspace-error' : 'submission-accepted'}>{result.exception || 'Execution completed'}</span><span className="workspace-muted">{result.executionTime != null ? `${result.executionTime} ms` : ''}{result.memoryUsed != null ? ` / ${(result.memoryUsed / 1024).toFixed(2)} MB` : ''}</span></div><pre className="workspace-output">{result.stdout || '(no standard output)'}</pre>{result.stderr && <pre className="workspace-output workspace-error">{result.stderr}</pre>}{result.truncated && <p className="workspace-error">Output was truncated.</p>}</>
}
