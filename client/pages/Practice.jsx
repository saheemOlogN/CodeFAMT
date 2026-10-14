import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Circle, List, Search, Trophy, RotateCcw } from 'lucide-react';
import { api } from '../api.js';
import Difficulty from '../components/Difficulty.jsx';
import { useSession } from '../context/SessionContext.js';
import { patterns } from '../../shared/catalog.js';

export default function Practice() {
  const { user, signIn } = useSession();
  const [problems, setProblems] = useState([]);
  const [solved, setSolved] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [pattern, setPattern] = useState('All topics');
  const [difficulty, setDifficulty] = useState('All difficulties');
  const [status, setStatus] = useState('All statuses');

  async function loadProblems() {
    setLoading(true);
    setError('');
    try {
      const data = await api('/problems');
      setProblems(data.problems);
      setSolved(data.solved);
    } catch {
      setProblems([]);
      setSolved([]);
      setError('Unable to load problems. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProblems();
  }, [user]);

  const filtered = useMemo(
    () =>
      problems.filter(
        (problem) =>
          (pattern === 'All topics' || problem.pattern === pattern) &&
          (difficulty === 'All difficulties' || problem.difficulty === difficulty) &&
          (status === 'All statuses' || (status === 'Solved') === solved.includes(problem._id)) &&
          problem.title.toLowerCase().includes(query.toLowerCase()),
      ),
    [problems, pattern, difficulty, status, query, solved],
  );

  const solvedCount = problems.filter((problem) => solved.includes(problem._id)).length;
  function resetFilters() {
    setQuery('');
    setPattern('All topics');
    setDifficulty('All difficulties');
    setStatus('All statuses');
  }

  return (
    <main className="problem-layout">
      <aside className="problem-sidebar">
        <span className="sidebar-label">Library</span>
        <button
          className={pattern === 'All topics' ? 'selected' : ''}
          onClick={() => setPattern('All topics')}
        >
          <List size={17} />
          All problems
        </button>
        <Link to="/contests">
          <Trophy size={17} />
          Contests
        </Link>
        <span className="sidebar-label topic-label">Topics</span>
        {patterns.map((name) => (
          <button
            key={name}
            className={pattern === name ? 'selected' : ''}
            onClick={() => setPattern(name)}
          >
            {name}
          </button>
        ))}
      </aside>
      <section className="problem-content">
        <div className="problem-heading">
          <h1>Problems</h1>
          {user?.admin && (
            <Link to="/admin" className="button secondary">
              Add problem
            </Link>
          )}
        </div>
        <div className="topic-list" aria-label="Problem topics">
          {['All topics', ...patterns].map((name) => (
            <button
              key={name}
              className={pattern === name ? 'active' : ''}
              onClick={() => setPattern(name)}
            >
              {name}
              {name !== 'All topics' && (
                <span>{problems.filter((problem) => problem.pattern === name).length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="problem-filters">
          <select
            aria-label="Filter by difficulty"
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value)}
          >
            {['All difficulties', 'Easy', 'Medium', 'Hard'].map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {['All statuses', 'Solved', 'Unsolved'].map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <div className="search-box">
            <Search size={16} />
            <input
              aria-label="Search problems"
              placeholder="Search questions"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <button
            className="icon-button"
            aria-label="Reset filters"
            title="Reset filters"
            onClick={resetFilters}
          >
            <RotateCcw size={15} />
          </button>
        </div>
        <div className="problem-table-wrap">
          <table className="problem-table">
            <thead>
              <tr>
                <th className="status-cell">Status</th>
                <th>Title</th>
                <th>Difficulty</th>
                <th>Topic</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((problem) => (
                <tr key={problem._id}>
                  <td className="status-cell">
                    {solved.includes(problem._id) ? (
                      <Check className="green" size={16} aria-label="Solved" />
                    ) : (
                      <Circle className="unsolved" size={13} aria-label="Unsolved" />
                    )}
                  </td>
                  <td>
                    <Link to={`/problems/${problem.slug}`}>{problem.title}</Link>
                  </td>
                  <td>
                    <Difficulty value={problem.difficulty} />
                  </td>
                  <td>
                    <button className="tag" onClick={() => setPattern(problem.pattern)}>
                      {problem.pattern}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading ? (
          <div className="table-empty" role="status">
            Loading problems…
          </div>
        ) : error ? (
          <div className="table-empty">
            <p role="alert">{error}</p>
            <button className="text-button" onClick={loadProblems}>
              Retry
            </button>
          </div>
        ) : !filtered.length ? (
          <div className="table-empty">
            <p>
              {problems.length ? 'No matching problems.' : 'No problems have been published yet.'}
            </p>
            {problems.length ? (
              <button className="text-button" onClick={resetFilters}>
                Clear filters
              </button>
            ) : user?.admin ? (
              <Link to="/admin" className="text-button">
                Create a problem
              </Link>
            ) : (
              <span>Problems added by the administrator will appear here.</span>
            )}
          </div>
        ) : null}
        {!loading && !error && (
          <div className="table-footer">
            {filtered.length} {filtered.length === 1 ? 'problem' : 'problems'}
          </div>
        )}
      </section>
      <aside className="practice-progress">
        <h2>Progress</h2>
        <div className="solved-total">
          <strong>{solvedCount}</strong>
          <span>/ {problems.length} solved</span>
        </div>
        <progress aria-label="Solved problems" value={solvedCount} max={problems.length || 1} />
        {['Easy', 'Medium', 'Hard'].map((level) => (
          <div className="progress-row" key={level}>
            <Difficulty value={level} />
            <span>
              {
                problems.filter(
                  (problem) => problem.difficulty === level && solved.includes(problem._id),
                ).length
              }
              <span className="muted">
                {' '}
                / {problems.filter((problem) => problem.difficulty === level).length}
              </span>
            </span>
          </div>
        ))}
        {!user && (
          <button className="text-button" onClick={signIn}>
            Sign in to track progress
          </button>
        )}
      </aside>
    </main>
  );
}
