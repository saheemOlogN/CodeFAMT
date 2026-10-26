import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Code2, FileCode2, History, LoaderCircle, RefreshCw, XCircle } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../context/auth'
import { useRealtime } from '../context/RealtimeProvider'
import { useApi } from '../hooks/useApi'
import CodeEditor from '../components/CodeEditor'
import { LANGUAGES, pending, Verdict, useTrackedRecord } from './ProblemPage'
import './Workspace.css'

function dateLabel(date) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date))
}

function problemLink(record) {
  return record.contest ? `/contests/${record.contest}/problems/${record.problem}` : `/problems/${record.problem}`
}

function SubmissionProblemLink({ record, title }) {
  const { data } = useApi(title ? null : problemLink(record))
  return <Link className="submission-problem-link" to={problemLink(record)}>{title || data?.problem?.title || `Problem ${record.problem.slice(-6).toUpperCase()}`}{record.contest && <span>Contest</span>}</Link>
}

export default function SubmissionsPage() {
  const [search, setSearch] = useSearchParams()
  const page = Math.max(1, Number(search.get('page')) || 1)
  const problemId = search.get('problemId') || ''
  const contestId = search.get('contestId') || ''
  const socket = useRealtime()
  const query = new URLSearchParams({ page: String(page), limit: '20', ...(problemId ? { problemId } : {}), ...(contestId ? { contestId } : {}) })
  const { data, loading, error, reload } = useApi(`/submissions?${query}`)
  const { data: problemData } = useApi(problemId ? contestId ? `/contests/${contestId}/problems/${problemId}` : `/problems/${problemId}` : null)
  const hasPending = data?.submissions?.some(item => pending(item.status))

  useEffect(() => {
    const refresh = () => reload()
    socket?.on('submission:updated', refresh)
    socket?.on('connect', refresh)
    const timer = hasPending ? setInterval(refresh, 5000) : null
    return () => {
      socket?.off('submission:updated', refresh)
      socket?.off('connect', refresh)
      clearInterval(timer)
    }
  }, [socket, hasPending, reload])

  function setPage(value) {
    const next = new URLSearchParams(search)
    next.set('page', String(value))
    setSearch(next)
  }

  return <div className="submission-page">
    <div className="submission-page-heading"><div><h1>Submissions</h1><p>{problemData?.problem?.title || (contestId ? 'Contest submission history' : 'Your submitted solutions and results.')}</p></div><button className="workspace-icon-button" title="Refresh submissions" aria-label="Refresh submissions" onClick={reload} disabled={loading}><RefreshCw size={18} className={loading ? 'workspace-spin' : ''} /></button></div>
    {(problemId || contestId) && <div className="submission-filter-bar"><span>Filtered by {problemId ? 'problem' : 'contest'}</span><Link to="/submissions">Clear filter</Link></div>}
    {error && <p role="alert" className="workspace-action-error">{error}</p>}
    {loading && !data ? <div className="workspace-state"><LoaderCircle size={24} className="workspace-spin" /><p>Loading submissions...</p></div> : data?.submissions?.length ? <>
      <div className="submission-table-wrap"><table className="submission-table">
        <thead><tr><th>Result</th><th>Problem</th><th>Language</th><th>Mode</th><th>Tests passed</th><th>Runtime</th><th>Submitted</th><th><span className="submission-sr-only">Details</span></th></tr></thead>
        <tbody>{data.submissions.map(record => <tr key={record._id}>
          <td><Link to={`/submissions/${record._id}`}><Verdict status={record.status} /></Link></td>
          <td><SubmissionProblemLink record={record} title={problemId ? problemData?.problem?.title : null} /></td>
          <td>{LANGUAGES.find(item => item.id === record.language)?.label || record.language}</td><td>{(record.mode || 'cp').toUpperCase()}</td>
          <td>{record.passedTests} / {record.totalTests}</td>
          <td>{record.executionTimeMs == null ? '-' : `${record.executionTimeMs} ms`}</td>
          <td className="submission-date">{dateLabel(record.createdAt)}</td>
          <td><Link className="workspace-icon-button" to={`/submissions/${record._id}`} aria-label={`View submission ${record._id.slice(-6)}`} title="View submission"><ArrowUpRight size={16} /></Link></td>
        </tr>)}</tbody>
      </table></div>
      <div className="submission-pagination"><span>{data.total} submissions</span><div><button className="workspace-icon-button" aria-label="Previous page" title="Previous page" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button><span>Page {page} of {Math.max(1, Math.ceil(data.total / 20))}</span><button className="workspace-icon-button" aria-label="Next page" title="Next page" disabled={page * 20 >= data.total || loading} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button></div></div>
    </> : !loading && !error && <div className="submission-empty"><History size={32} /><h2>No submissions yet</h2><p>Your solutions will appear here after you submit them.</p><Link to="/problems" className="workspace-button workspace-primary"><Code2 size={15} />Browse problems</Link></div>}
  </div>
}

export function SubmissionDetailPage() {
  const { submissionId } = useParams()
  const { data, loading, error, reload } = useApi(`/submissions/${submissionId}`)
  if (loading && !data?.submission) return <div className="workspace-state"><LoaderCircle size={24} className="workspace-spin" /><p>Loading submission...</p></div>
  if (error && !data?.submission) return <div className="workspace-state"><XCircle size={26} /><h1>Submission unavailable</h1><p role="alert">{error}</p><button className="workspace-button" onClick={reload}><RefreshCw size={15} />Try again</button><Link to="/submissions">Back to submissions</Link></div>
  return data?.submission ? <SubmissionDetail key={submissionId} initialSubmission={data.submission} /> : null
}

function SubmissionDetail({ initialSubmission }) {
  const { token } = useAuth()
  const [submission, setSubmission] = useState(initialSubmission)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')
  const trackError = useTrackedRecord(submission, setSubmission, 'submission')

  async function retry() {
    setRetrying(true)
    setRetryError('')
    try {
      const result = await api(`/submissions/${submission._id}/retry`, { method: 'POST', body: {}, token })
      setSubmission(current => ({ ...current, ...result.submission }))
    } catch (failure) { setRetryError(failure.message) }
    finally { setRetrying(false) }
  }

  return <div className="submission-page submission-detail"><Link className="submission-back" to="/submissions"><ArrowLeft size={15} />Submissions</Link><div className="submission-page-heading"><div><h1>Submission #{submission._id.slice(-8)}</h1><p>{dateLabel(submission.createdAt)}</p></div><Link className="workspace-button" to={problemLink(submission)}>Open problem<ArrowUpRight size={15} /></Link></div>
    <div className="submission-result-band"><Verdict status={submission.status} /><div><span>Tests passed</span><strong>{submission.passedTests} / {submission.totalTests}</strong></div><div><span>Runtime</span><strong>{submission.executionTimeMs == null ? '-' : `${submission.executionTimeMs} ms`}</strong></div><div><span>Memory</span><strong>{submission.memoryUsedMb == null ? '-' : `${submission.memoryUsedMb.toFixed(2)} MB`}</strong></div><div><span>Mode</span><strong>{(submission.mode || 'cp').toUpperCase()}</strong></div><div><span>Language</span><strong>{LANGUAGES.find(item => item.id === submission.language)?.label || submission.language}</strong></div></div>
    {pending(submission.status) && <p className="submission-pending-message">{submission.status === 'queued' ? 'Your solution is in the judging queue.' : 'Your solution is being judged.'}</p>}
    {submission.errorMessage && <p className="workspace-action-error">{submission.errorMessage}</p>}
    {(trackError || retryError) && <p className="workspace-action-error" role="alert">{retryError || trackError}</p>}
    {submission.status === 'internal_error' && <button className="workspace-button submission-retry" onClick={retry} disabled={retrying}><RefreshCw size={15} className={retrying ? 'workspace-spin' : ''} />Retry judging</button>}
    <section className="submission-source"><div className="workspace-panel-heading"><FileCode2 size={16} /><span>Submitted source</span><span className="workspace-save-state">{LANGUAGES.find(item => item.id === submission.language)?.filename}</span></div><CodeEditor value={submission.code || ''} language={submission.language} readOnly height="500px" /></section>
  </div>
}

