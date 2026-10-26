import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useApi } from '../hooks/useApi'
import { dateTime, Difficulty, EmptyState, LoadState, Pagination } from '../components/PlatformUI'

export default function SolvedPage() {
  const [page, setPage] = useState(1)
  const { data, loading, error, reload } = useApi(`/users/me/solved?page=${page}&limit=20`)
  useEffect(() => { document.title = 'Solved problems | CodeFAMT' }, [])
  return <section className="platform-page"><div className="platform-heading"><h1>Solved problems</h1></div><LoadState loading={loading} error={error} retry={reload} />{!loading && !error && data && <>{data.solvedProblems.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Problem</th><th>Difficulty</th><th>First solved</th><th>Solution</th></tr></thead><tbody>{data.solvedProblems.map(item => <tr key={item.id}><td><strong>{item.problem?.title || 'Unavailable problem'}</strong></td><td><Difficulty value={item.problem?.difficulty} /></td><td className="muted-text">{dateTime(item.solvedAt)}</td><td><Link className="inline-link" to={`/submissions/${item.submission}`}>View solution<ArrowRight size={14} /></Link></td></tr>)}</tbody></table></div> : <EmptyState title="No solved problems yet"><Link to="/problems" className="text-button">Explore problems</Link></EmptyState>}<Pagination page={page} total={data.total} onChange={setPage} /></>}</section>
}

