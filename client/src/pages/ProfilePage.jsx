import { Link } from 'react-router-dom'
import { Check, GraduationCap, CalendarDays, Code2, ArrowRight } from 'lucide-react'
import { useApi } from '../hooks/useApi'
import { useRealtime } from '../context/RealtimeProvider'
import { dateTime, Difficulty, LoadState, EmptyState } from '../components/PlatformUI'
import ActivityHeatmap from '../components/ActivityHeatmap'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/auth'
import Dialog from '../components/Dialog'
import StudentFields from '../components/StudentFields'
import { departments } from '../departments'

export default function ProfilePage({ admin }) {
  const { user, token, logout, refreshUser, clearSession } = useAuth()
  const [values, setValues] = useState({
    name: user.name,
    department: user.department,
    year: user.year,
  })
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    document.title = `${admin ? 'Admin account' : 'My profile'} | CodeFAMT`
  }, [admin])

  const stats = useApi('/users/me/stats')
  const recent = useApi('/users/me/solved?limit=8&page=1')
  const socket = useRealtime()
  useEffect(() => {
    function update() { stats.reload(); recent.reload(); refreshUser(true) }
    socket?.on('submission:updated', update)
    socket?.on('connect', update)
    return () => { socket?.off('submission:updated', update); socket?.off('connect', update) }
  }, [socket, stats.reload, recent.reload, refreshUser])
  const difficulties = stats.data?.difficulties || []
  const total = difficulties.reduce((sum, item) => sum + item.total, 0)
  const solved = difficulties.reduce((sum, item) => sum + item.solved, 0)

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await api('/users/me', {
        method: 'PATCH',
        token,
        body: { ...values, name: values.name.trim() },
      })
      await refreshUser(true)
      setMessage('Your profile has been updated.'); setEditing(false)
    } catch (failure) {
      if (failure.status === 401 || failure.status === 403) clearSession()
      else setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true)
    setError('')
    try {
      await logout()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="profile-page">
      <h1 className="profile-accessible-title">{admin ? 'Admin account' : 'My profile'}</h1>
      <div className="profile-grid">
        <aside className="panel profile-summary">
          <div className="profile-identity">
            <div className="avatar">{user.name.charAt(0).toUpperCase()}</div>
            <div><h2>{user.name}</h2><p className="profile-email">{user.email}</p><span className="profile-role">{user.role === 'admin' ? 'Administrator' : 'Student'}</span></div>
          </div>
          <div className="profile-facts">
            <p><GraduationCap size={17} /><span>Finolex Academy of Management and Technology</span></p>
            <p><Code2 size={17} /><span>{departments.find(([value]) => value === user.department)?.[1]} · Year {user.year}</span></p>
            {user.createdAt && <p><CalendarDays size={17} /><span>Joined {new Date(user.createdAt).toLocaleDateString('en', { month: 'long', year: 'numeric' })}</span></p>}
          </div>
          <button className="secondary-button" onClick={() => { setValues({ name: user.name, department: user.department, year: user.year }); setError(''); setEditing(true) }}>Edit personal information</button>
          {message && <p role="status" className="notice notice-success">{message}</p>}
          {editing && <Dialog title="Edit personal information" busy={busy} onClose={() => setEditing(false)}>
            {error && <p role="alert" className="notice notice-error">{error}</p>}
            {message && (
              <p role="status" className="notice notice-success">
                {message}
              </p>
            )}
            <form onSubmit={save}>
              <fieldset disabled={busy}>
                <StudentFields
                  values={values}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      [event.target.name]: event.target.value,
                    })
                  }
                />
                <label>
                  College email
                  <input value={user.email} disabled />
                </label>
                <p className="small-note">
                  Your verified college email cannot be changed here.
                </p>
                <button className="primary-button save-button" type="submit">
                  {busy ? 'Please wait...' : 'Save changes'}
                </button>
              </fieldset>
            </form>
          </Dialog>}
          {error && !editing && <p role="alert" className="notice notice-error">{error}</p>}
          <button className="text-button profile-signout" disabled={busy} onClick={signOut}>Sign out on all devices</button>
          <section className="profile-languages"><h3>Languages</h3>
            {stats.data?.languages?.length ? stats.data.languages.map(item => <div key={item.language}><span>{({ cpp: 'C++', c: 'C', java: 'Java', python: 'Python', javascript: 'JavaScript' })[item.language] || item.language}</span><small>{item.count} submissions</small></div>) : <p className="muted-text">{stats.loading ? 'Loading…' : stats.error ? 'Statistics unavailable' : 'No submissions yet'}</p>}
          </section>
        </aside>
        <div className="profile-content">
          <div className="profile-top-grid">
            <section className="panel solving-panel" aria-label="Problem solving progress">
              <LoadState loading={stats.loading} error={stats.error} retry={stats.reload} />
              {!stats.loading && !stats.error && <>
                <div className="solve-ring" style={{ '--progress': `${total ? solved / total * 100 : 0}%` }}><div><p><strong>{solved}</strong><span>/{total}</span></p><span><Check size={16} /> Solved</span><small>Practice problems</small></div></div>
                <div className="difficulty-progress">{difficulties.map(item => <Link to={`/problems?difficulty=${item.difficulty}`} key={item.difficulty}><Difficulty value={item.difficulty} /><strong>{item.solved}<span> / {item.total}</span></strong></Link>)}</div>
              </>}
            </section>
            <section className="panel profile-practice"><h2>Your progress</h2><p className="profile-total">{user.solvedCount ?? 0}<span>problems solved</span></p><p className="muted-text">Across practice and contests</p><div className="profile-shortcuts"><Link to="/solved">Solved problems <ArrowRight size={16} /></Link><Link to="/contests">Explore contests <ArrowRight size={16} /></Link><Link to="/leaderboard">Leaderboard <ArrowRight size={16} /></Link></div></section>
          </div>
          <ActivityHeatmap />
          <section className="panel profile-recent"><div className="section-heading"><h2><Check size={18} /> Recently solved</h2><Link to="/submissions">All submissions <ArrowRight size={15} /></Link></div>
            <LoadState loading={recent.loading} error={recent.error} retry={recent.reload} />
            {!recent.loading && !recent.error && (recent.data?.solvedProblems?.length ? <div className="profile-recent-list">{recent.data.solvedProblems.map(item => <Link key={item.id} to={`/submissions/${item.submission}`}><strong>{item.problem?.title || 'Unavailable problem'}</strong><time>{dateTime(item.solvedAt)}</time></Link>)}</div> : <EmptyState title="No solved problems yet"><Link className="text-button" to="/problems">Explore problems</Link></EmptyState>)}
          </section>
        </div>
      </div>
    </section>
  )
}
