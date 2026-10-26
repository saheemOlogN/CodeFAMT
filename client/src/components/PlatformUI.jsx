import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react'

export function LoadState({ loading, error, retry }) {
  if (error) return <div className="empty-state"><CircleAlert size={26} /><p role="alert">{error}</p><button className="secondary-button" onClick={retry}><RefreshCw size={14} />Try again</button></div>
  if (loading) return <div className="empty-state" role="status"><LoaderCircle className="spin" size={24} /><p>Loading...</p></div>
  return null
}
export function EmptyState({ title, children }) {
  return <div className="empty-state"><h3>{title}</h3>{children && <p>{children}</p>}</div>
}
export function Pagination({ page, total, limit = 20, onChange }) {
  const pages = Math.max(1, Math.ceil(total / limit))
  return <div className="pagination"><span>{total ? `${(page - 1) * limit + 1}-${Math.min(page * limit, total)} of ${total}` : '0 results'}</span><div><button className="icon-button" title="Previous page" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)}><ArrowLeft size={16} /></button><span>Page {page} of {pages}</span><button className="icon-button" title="Next page" aria-label="Next page" disabled={page >= pages} onClick={() => onChange(page + 1)}><ArrowRight size={16} /></button></div></div>
}
export function Difficulty({ value }) { return <span className={`difficulty difficulty-${value}`}>{value}</span> }
export function StatusBadge({ value }) { return <span className={`status-badge status-${value}`}>{value === 'live' ? 'In progress' : value?.replaceAll('_', ' ')}</span> }
export function dateTime(value) { return value ? new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '--' }
export function contestPhase(contest, now = Date.now()) {
  if (contest.status !== 'published') return contest.status
  if (now < new Date(contest.startTime).getTime()) return 'upcoming'
  return now < new Date(contest.endTime).getTime() ? 'live' : 'ended'
}
