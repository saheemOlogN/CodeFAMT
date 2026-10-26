import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, LockKeyhole, RefreshCw, Trophy } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../context/auth'
import { useRealtime } from '../context/RealtimeProvider'
import { useApi } from '../hooks/useApi'
import { useServerClock } from '../hooks/useServerClock'
import { contestPhase, dateTime, Difficulty, EmptyState, LoadState, Pagination, StatusBadge } from '../components/PlatformUI'
import FadeContent from '../components/FadeContent'

function countdown(until, now) {
  const seconds = Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000))
  const days = Math.floor(seconds / 86400)
  return `${days ? `${days}d ` : ''}${String(Math.floor(seconds / 3600) % 24).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function Leaderboard({ contestId }) {
  const [page, setPage] = useState(1)
  const { user } = useAuth()
  const { data, loading, error, reload } = useApi(`/contests/${contestId}/leaderboard?page=${page}&limit=20`)
  const socket = useRealtime()
  useEffect(() => {
    const update = payload => { if (payload.contestId === contestId) reload() }
    socket?.on('leaderboard:updated', update)
    socket?.on('connect', reload)
    const timer = setInterval(reload, 15000)
    return () => { socket?.off('leaderboard:updated', update); socket?.off('connect', reload); clearInterval(timer) }
  }, [contestId, socket, reload])
  return <section><div className="section-heading"><h2>Standings</h2><button className="icon-button" title="Refresh standings" aria-label="Refresh standings" disabled={loading} onClick={reload}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button></div><LoadState loading={loading && !data} error={error} retry={reload} />{data && !error && <>{data.leaderboard.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Rank</th><th>Participant</th><th>Department</th><th>Solved</th><th>Score</th></tr></thead><tbody>{data.leaderboard.map(row => <tr key={row.user._id} className={row.user._id === (user.id || user._id) ? 'own-row' : ''}><td><span className={row.rank <= 3 ? 'rank-medal' : 'muted-text'}>{String(row.rank).padStart(2, '0')}</span></td><td><strong>{row.user.name}</strong>{row.user._id === (user.id || user._id) && <span className="you-label">You</span>}</td><td className="muted-text">{row.user.department.toUpperCase()} · {row.user.year}</td><td>{row.solvedCount}</td><td className="score-value">{row.score}</td></tr>)}</tbody></table></div> : <EmptyState title="The leaderboard is open">Registered participants will appear here.</EmptyState>}<Pagination page={page} total={data.total} onChange={setPage} /></>}<p className="table-footnote">Each accepted problem earns its points once. Ties are settled by the earliest final scoring submission.</p></section>
}

export default function ContestPage() {
  const { contestId } = useParams()
  const { user, token, clearSession } = useAuth()
  const details = useApi(`/contests/${contestId}`)
  const socket = useRealtime()
  const now = useServerClock(details.data?.serverNow)
  const [tab, setTab] = useState('problems')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const contest = details.data?.contest
  const phase = contest ? contestPhase(contest, now) : ''
  const previousPhase = useRef(phase)
  useEffect(() => { if (contest) document.title = `${contest.title} | CodeFAMT` }, [contest])
  useEffect(() => {
    if (previousPhase.current && phase !== previousPhase.current) details.reload()
    previousPhase.current = phase
  }, [phase, details.reload])
  useEffect(() => {
    if (!socket) return
    function joinRoom() {
      details.reload()
      if (details.data?.joined || user.role === 'admin') socket.emit('contest:join', { contestId }, () => {})
    }
    const update = payload => { if (payload.contestId === contestId) details.reload() }
    if (socket.connected && (details.data?.joined || user.role === 'admin')) socket.emit('contest:join', { contestId }, () => {})
    socket.on('connect', joinRoom)
    socket.on('contest:updated', update)
    return () => { socket.off('connect', joinRoom); socket.off('contest:updated', update); socket.emit('contest:leave', { contestId }, () => {}) }
  }, [socket, contestId, details.data?.joined, details.reload, user.role])
  useEffect(() => { const timer = setInterval(details.reload, 20000); return () => clearInterval(timer) }, [details.reload])
  async function join() {
    setBusy(true); setError('')
    try { await api(`/contests/${contestId}/join`, { method: 'POST', token, body: {} }); details.reload() }
    catch (failure) { if (failure.status === 401) clearSession(); else setError(failure.message) }
    finally { setBusy(false) }
  }
  const canViewLeaderboard = contest?.status === 'published' && (phase !== 'upcoming' || user.role === 'admin')
  return <FadeContent className="platform-page"><Link to="/contests" className="back-link"><ArrowLeft size={15} />All contests</Link><LoadState loading={details.loading && !contest} error={details.error} retry={details.reload} />{contest && !details.error && <><div className="contest-detail-heading"><div><StatusBadge value={phase} /><h1>{contest.title}</h1><p>{contest.description}</p><div className="contest-meta"><span><CalendarDays size={16} />{dateTime(contest.startTime)}</span><span><Clock3 size={16} />{Math.round((new Date(contest.endTime) - new Date(contest.startTime)) / 60000)} minutes</span><span><Trophy size={16} />{contest.problemCount} problems</span></div></div><div className="contest-countdown">{['live', 'upcoming'].includes(phase) && <><span>{phase === 'live' ? 'Time remaining' : 'Starts in'}</span><strong>{countdown(phase === 'live' ? contest.endTime : contest.startTime, now)}</strong></>}{details.data.joined ? <span className="joined-label"><Check size={16} />Registered</span> : ['live', 'upcoming'].includes(phase) ? <button className="primary-button" disabled={busy} onClick={join}>{busy ? 'Joining...' : 'Join contest'}<ArrowRight size={16} /></button> : <span className="muted-text">{phase === 'ended' ? 'Contest completed' : phase === 'cancelled' ? 'Contest cancelled' : 'Draft contest'}</span>}</div></div>{error && <p role="alert" className="notice notice-error">{error}</p>}<div className="view-tabs" role="tablist" aria-label="Contest views"><button role="tab" aria-selected={tab === 'problems'} onClick={() => setTab('problems')}>Problems</button><button role="tab" aria-selected={tab === 'standings'} onClick={() => setTab('standings')}>Standings</button></div><div className="contest-content" role="tabpanel" aria-label={tab === 'problems' ? 'Problems' : 'Standings'}>{tab === 'standings' ? canViewLeaderboard ? <Leaderboard key={contestId} contestId={contestId} /> : <div className="empty-state"><LockKeyhole size={26} /><h3>Standings are not open yet</h3><p>The leaderboard opens when the contest begins.</p></div> : contest.problems?.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Problem</th><th>Difficulty</th><th>Points</th><th /></tr></thead><tbody>{contest.problems.map((entry, index) => <tr key={entry.problem?._id || index}><td>{entry.problem ? <Link className="problem-link" to={`/contests/${contestId}/problems/${entry.problem._id}`}><span className="problem-letter">{String.fromCharCode(65 + index)}</span>{entry.problem.title}</Link> : 'Unavailable problem'}</td><td><Difficulty value={entry.problem?.difficulty} /></td><td>{entry.points}</td><td>{entry.problem && <Link className="icon-button" title={`Open ${entry.problem.title}`} aria-label={`Open ${entry.problem.title}`} to={`/contests/${contestId}/problems/${entry.problem._id}`}><ArrowRight size={16} /></Link>}</td></tr>)}</tbody></table></div> : <div className="empty-state"><LockKeyhole size={26} /><h3>{phase === 'cancelled' ? 'This contest was cancelled' : phase === 'upcoming' ? 'The challenge is under wraps' : !details.data.joined ? 'Reserved for registered participants' : 'No problems available'}</h3><p>{phase === 'upcoming' ? 'Problems open for registered participants at the start time.' : phase === 'live' ? 'Join the contest to access the problems.' : ''}</p></div>}</div></>}</FadeContent>
}
