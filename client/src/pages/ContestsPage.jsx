import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useServerClock } from '../hooks/useServerClock'
import { contestPhase, dateTime, EmptyState, LoadState, Pagination, StatusBadge } from '../components/PlatformUI'
import FadeContent from '../components/FadeContent'

export default function ContestsPage() {
  const { data, loading, error, reload } = useCollection('/contests', 'contests')
  const now = useServerClock(data?.serverNow)
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  useEffect(() => {
    document.title = 'Contests | CodeFAMT'
    const timer = setInterval(reload, 60000)
    return () => clearInterval(timer)
  }, [reload])
  const contests = (data?.contests || []).filter(contest => filter === 'all' || contestPhase(contest, now) === filter)
  const order = { live: 0, upcoming: 1, ended: 2, draft: 3, cancelled: 4 }
  contests.sort((a, b) => order[contestPhase(a, now)] - order[contestPhase(b, now)] || (contestPhase(a, now) === 'upcoming' ? new Date(a.startTime) - new Date(b.startTime) : new Date(b.startTime) - new Date(a.startTime)))
  const currentPage = Math.min(page, Math.max(1, Math.ceil(contests.length / 12)))

  return <FadeContent className="platform-page">
    <div className="platform-heading"><h1>Contests</h1></div>
    <div className="section-toolbar">
      <div className="segmented-control" aria-label="Contest status">
        {['all', 'live', 'upcoming', 'ended'].map(value => <button key={value} aria-pressed={filter === value} className={filter === value ? 'selected' : ''} onClick={() => { setFilter(value); setPage(1) }}>
          {value === 'all' ? 'All contests' : value === 'ended' ? 'Past' : value === 'live' ? 'In progress' : 'Upcoming'}
        </button>)}
      </div>
      <span className="muted-text">{data ? contests.length + ' contests' : ''}</span>
    </div>
    <LoadState loading={loading && !data} error={error} retry={reload} />
    {data && !error && <>
      {contests.length ? <div className="contest-grid">{contests.slice((currentPage - 1) * 12, currentPage * 12).map(contest => {
        const phase = contestPhase(contest, now)
        return <article className="contest-card" key={contest._id}>
          <div>
            <div className="contest-title"><h2><Link to={'/contests/' + contest._id}>{contest.title}</Link></h2><StatusBadge value={phase} /></div>
            {contest.description && <p>{contest.description}</p>}
          </div>
          <div className="contest-meta"><span>{dateTime(contest.startTime)}</span><span>{Math.round((new Date(contest.endTime) - new Date(contest.startTime)) / 60000)} minutes</span></div>
          <Link className="contest-card-link" to={'/contests/' + contest._id}>{phase === 'live' ? 'Enter contest' : phase === 'ended' ? 'View results' : 'View contest'}<ArrowRight size={16} /></Link>
        </article>
      })}</div> : <EmptyState title="No contests found">Published contests will appear here.</EmptyState>}
      <Pagination page={currentPage} total={contests.length} limit={12} onChange={setPage} />
    </>}
  </FadeContent>
}
