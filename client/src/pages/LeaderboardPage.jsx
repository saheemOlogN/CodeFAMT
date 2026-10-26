import { useEffect, useState } from 'react'
import { useAuth } from '../context/auth'
import { useApi } from '../hooks/useApi'
import { useCollection } from '../hooks/useCollection'
import { EmptyState, LoadState, Pagination } from '../components/PlatformUI'
import { departments } from '../departments'
import './LeaderboardPage.css'

const departmentNames = Object.fromEntries(departments)
const years = ['1st', '2nd', '3rd', '4th']
const pageSize = 20

function solvedDate(value) {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—'
}

export default function LeaderboardPage() {
  const { user } = useAuth()
  const [department, setDepartment] = useState('')
  const [year, setYear] = useState('')
  const [problemId, setProblemId] = useState('')
  const [page, setPage] = useState(1)
  const problems = useCollection('/problems?visibility=public', 'problems')
  const query = new URLSearchParams({ page: String(page), limit: String(pageSize) })
  if (department) query.set('department', department)
  if (year) query.set('year', year)
  if (problemId) query.set('problemId', problemId)
  const { data, loading, error, reload } = useApi(`/users/leaderboard?${query}`)
  const rows = data?.leaderboard || []
  const hasFilters = Boolean(department || year || problemId)
  const publicProblems = (problems.data?.problems || []).filter(problem => problem.visibility === 'public')

  useEffect(() => { document.title = 'Leaderboard | CodeFAMT' }, [])

  function filter(setter, value) {
    setter(value)
    setPage(1)
  }

  function resetFilters() {
    setDepartment('')
    setYear('')
    setProblemId('')
    setPage(1)
  }

  return <section className="platform-page leaderboard-page" aria-labelledby="leaderboard-title">
    <div className="platform-heading">
      <div>
        <h1 id="leaderboard-title">Leaderboard</h1>
        <p>{problemId ? 'Ranked by the earliest accepted solution for this problem.' : 'Ranked by unique public problems solved. Equal totals share a rank.'}</p>
      </div>
    </div>

    <div className="filter-bar leaderboard-filters" role="group" aria-label="Leaderboard filters">
      <label htmlFor="leaderboard-department">Department
        <select id="leaderboard-department" value={department} onChange={event => filter(setDepartment, event.target.value)}>
          <option value="">All departments</option>
          {departments.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label htmlFor="leaderboard-year">Year
        <select id="leaderboard-year" value={year} onChange={event => filter(setYear, event.target.value)}>
          <option value="">All years</option>
          {years.map(value => <option key={value} value={value}>{value} year</option>)}
        </select>
      </label>
      <label htmlFor="leaderboard-problem">Problem
        <select id="leaderboard-problem" value={problemId} disabled={problems.loading || Boolean(problems.error)} onChange={event => filter(setProblemId, event.target.value)}>
          <option value="">{problems.loading ? 'Loading problems…' : 'All problems'}</option>
          {publicProblems.map(problem => <option key={problem._id} value={problem._id}>{problem.title}</option>)}
        </select>
      </label>
      <button className="secondary-button leaderboard-reset" disabled={!hasFilters} onClick={resetFilters}>Reset filters</button>
    </div>

    {problems.error && <div className="notice notice-error leaderboard-filter-error" role="alert">
      <span>Problem filters are unavailable. {problems.error}</span>
      <button className="text-button" onClick={problems.reload}>Retry problems</button>
    </div>}

    <LoadState loading={loading} error={error} retry={reload} />
    {!loading && !error && data && <>
      {rows.length ? <div className="table-scroll">
        <table className="data-table leaderboard-table">
          <caption className="sr-only">Student rankings{problemId ? ' by earliest accepted solution' : ' by total problems solved'}</caption>
          <thead><tr>
            <th scope="col" className="leaderboard-rank">Rank</th>
            <th scope="col">Student</th>
            <th scope="col">Department</th>
            <th scope="col">Year</th>
            {problemId ? <th scope="col">First solved</th> : <>
              <th scope="col" className="leaderboard-number">Solved</th>
              <th scope="col" className="leaderboard-number">Easy</th>
              <th scope="col" className="leaderboard-number">Medium</th>
              <th scope="col" className="leaderboard-number">Hard</th>
            </>}
          </tr></thead>
          <tbody>{rows.map(row => {
            const isCurrentUser = row.user.id === (user?.id || user?._id)
            return <tr key={row.user.id} className={isCurrentUser ? 'leaderboard-current-user' : ''}>
              <td className="leaderboard-rank">{row.rank}</td>
              <td><div className="leaderboard-student"><strong>{row.user.name}</strong>{isCurrentUser && <span className="leaderboard-you">You</span>}</div></td>
              <td>{departmentNames[row.user.department] || row.user.department || '—'}</td>
              <td className="leaderboard-year">{row.user.year ? `${row.user.year} year` : '—'}</td>
              {problemId ? <td className="leaderboard-date"><time dateTime={row.lastSolvedAt || undefined}>{solvedDate(row.lastSolvedAt)}</time></td> : <>
                <td className="leaderboard-number"><strong>{row.solvedCount}</strong></td>
                <td className="leaderboard-number">{row.easyCount}</td>
                <td className="leaderboard-number">{row.mediumCount}</td>
                <td className="leaderboard-number">{row.hardCount}</td>
              </>}
            </tr>
          })}</tbody>
        </table>
      </div> : <EmptyState title={hasFilters ? 'No matching students' : 'No students yet'}>
        {problemId ? 'No accepted solutions match these filters.' : hasFilters ? 'Try another department or year.' : 'Student rankings will appear here after registration.'}
      </EmptyState>}
      <Pagination page={page} limit={pageSize} total={data.total} onChange={setPage} />
    </>}
  </section>
}
