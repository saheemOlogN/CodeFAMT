import { useEffect, useMemo, useState } from 'react'

import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Check, Search, X, SlidersHorizontal, Shuffle, Layers } from 'lucide-react'

import { useCollection } from '../hooks/useCollection'

import { useRealtime } from '../context/RealtimeProvider'

import { Difficulty, EmptyState, LoadState, Pagination } from '../components/PlatformUI'

import FadeContent from '../components/FadeContent'

import './ProblemsPage.css'



export default function ProblemsPage() {

  const library = useCollection('/problems?visibility=public', 'problems')

  const solved = useCollection('/users/me/solved', 'solvedProblems')

  const socket = useRealtime()

  const navigate = useNavigate()

  const [sort, setSort] = useState('newest')

  const [showFilters, setShowFilters] = useState(false)

  const [expandedTopics, setExpandedTopics] = useState(false)

  const [query, setQuery] = useState('')

  const [searchParams] = useSearchParams()
  const initialDifficulty = searchParams.get('difficulty') || ''
  const [difficulty, setDifficulty] = useState(['easy', 'medium', 'hard'].includes(initialDifficulty) ? initialDifficulty : '')

  const [topic, setTopic] = useState('')

  const [status, setStatus] = useState('')

  const [page, setPage] = useState(1)

  const problems = library.data?.problems || []

  const solvedIds = useMemo(() => new Set((solved.data?.solvedProblems || []).map(item => item.problem?.id)), [solved.data])

  const topics = [...new Set(problems.flatMap(problem => problem.tags || []))].sort()

  const filtered = problems.filter(problem =>

    (!query || `${problem.title} ${problem.tags?.join(' ')}`.toLowerCase().includes(query.toLowerCase())) &&

    (!difficulty || problem.difficulty === difficulty) && (!topic || problem.tags?.includes(topic)) &&

    (!status || solvedIds.has(problem._id) === (status === 'solved')))

  if (sort === 'title') filtered.sort((a, b) => a.title.localeCompare(b.title))

  if (sort === 'difficulty') filtered.sort((a, b) => ['easy', 'medium', 'hard'].indexOf(a.difficulty) - ['easy', 'medium', 'hard'].indexOf(b.difficulty))

  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 20)))

  const pageItems = filtered.slice((currentPage - 1) * 20, currentPage * 20)

  useEffect(() => { document.title = 'Problems | CodeFAMT' }, [])

  useEffect(() => {

    const update = ({ submission }) => { if (submission?.status === 'accepted') solved.reload() }

    socket?.on('submission:updated', update)

    socket?.on('connect', solved.reload)

    return () => { socket?.off('submission:updated', update); socket?.off('connect', solved.reload) }

  }, [socket, solved.reload])

  function filter(setter, value) { setter(value); setPage(1) }

  function reset() { setQuery(''); setDifficulty(''); setTopic(''); setStatus(''); setSort('newest'); setPage(1) }

  const solvedCount = problems.filter(problem => solvedIds.has(problem._id)).length

  return <FadeContent className="platform-page problem-library">

    <div className="platform-heading"><h1>Problems</h1><Link className="text-button" to="/solved">Solved problems</Link></div>

    <div className="library-topics" role="group" aria-label="Problem topics">

      <button className="topic-chip" aria-pressed={!topic} onClick={() => filter(setTopic, '')}><Layers size={17} />All topics<span>{problems.length}</span></button>

      {(expandedTopics ? topics : topics.slice(0, 8)).map(tag => <button key={tag} className="topic-chip" aria-pressed={topic === tag} onClick={() => filter(setTopic, topic === tag ? '' : tag)}>{tag}<span>{problems.filter(problem => problem.tags?.includes(tag)).length}</span></button>)}

      {topics.length > 8 && <button className="text-button" aria-expanded={expandedTopics} onClick={() => setExpandedTopics(!expandedTopics)}>{expandedTopics ? 'Show less' : 'More topics'}</button>}

    </div>

    <section aria-label="Practice problems">

      <div className="library-toolbar">

        <div className="search-field"><Search size={17} /><input aria-label="Search problems" placeholder="Search questions" value={query} onChange={event => filter(setQuery, event.target.value)} />{query && <button className="icon-button" aria-label="Clear search" onClick={() => filter(setQuery, '')}><X size={14} /></button>}</div>

        <select className="library-sort" aria-label="Sort problems" value={sort} onChange={event => filter(setSort, event.target.value)}><option value="newest">Newest first</option><option value="title">Title A–Z</option><option value="difficulty">Difficulty</option></select>

        <button className="icon-button library-filter-button" aria-label="Filter problems" title="Filters" aria-expanded={showFilters} aria-controls="library-filters" onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal size={17} /></button>

        <span className="library-solved">{solved.data && library.data ? `${solvedCount}/${problems.length}` : '—'} <span>Solved</span></span>

        <button className="icon-button" aria-label="Pick a random problem" title="Random problem" disabled={!filtered.length || library.loading} onClick={() => navigate(`/problems/${filtered[Math.floor(Math.random() * filtered.length)]._id}`)}><Shuffle size={18} /></button>

      </div>

      {showFilters && <div id="library-filters" className="library-filters">

        <label>Difficulty<select value={difficulty} onChange={event => filter(setDifficulty, event.target.value)}><option value="">All difficulties</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>

        <label>Problem status<select value={status} disabled={solved.loading || Boolean(solved.error)} onChange={event => filter(setStatus, event.target.value)}><option value="">All statuses</option><option value="solved">Solved</option><option value="unsolved">Unsolved</option></select></label>

      </div>}

      {(query || difficulty || topic || status || sort !== 'newest') && <div className="library-filter-summary"><span>{filtered.length} matching problems{difficulty && ` · ${difficulty}`}{status && ` · ${status}`}</span><button className="text-button" onClick={reset}>Clear filters</button></div>}

      {solved.error && <div className="notice notice-error" role="alert">Solved status unavailable. <button className="text-button" onClick={solved.reload}>Retry</button></div>}

      <LoadState loading={library.loading} error={library.error} retry={library.reload} />

      {!library.loading && !library.error && <>

        <div className="table-scroll"><table className="question-list"><thead className="sr-only"><tr><th>Status</th><th>Problem</th><th>Topics</th><th>Difficulty</th></tr></thead><tbody>{pageItems.map((problem, index) => <tr key={problem._id}>

          <td className="question-status">{solved.error || solved.loading ? <span aria-label="Status unavailable">—</span> : solvedIds.has(problem._id) ? <Check size={19} aria-label="Solved" /> : <span className="sr-only">Unsolved</span>}</td>

          <td><Link className="question-title" to={`/problems/${problem._id}`}><span className="question-number">{(currentPage - 1) * 20 + index + 1}.</span> {problem.title}</Link></td>

          <td className="question-topics">{problem.tags?.slice(0, 2).join(', ')}</td>

          <td className="question-difficulty"><Difficulty value={problem.difficulty} /></td>

        </tr>)}</tbody></table></div>

        {!filtered.length && <EmptyState title={problems.length ? 'No matching problems' : 'No problems yet'}>{problems.length ? <button className="text-button" onClick={reset}>Clear filters</button> : 'Published practice problems will appear here.'}</EmptyState>}

        <Pagination page={currentPage} limit={20} total={filtered.length} onChange={setPage} />

      </>}

    </section>

  </FadeContent>

}

