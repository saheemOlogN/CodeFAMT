import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Trophy, Clock, ArrowRight, ArrowLeft, CalendarDays } from 'lucide-react';
import { api, post } from '../api.js';
import Difficulty from '../components/Difficulty.jsx';
import Empty from '../components/Empty.jsx';
import { useSession } from '../context/SessionContext.js';

export default function Contests() {
  const { id } = useParams(),
    { user, signIn } = useSession();
  const [contests, setContests] = useState([]),
    [contest, setContest] = useState(null),
    [leaders, setLeaders] = useState([]),
    [pending, setPending] = useState(0),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [now, setNow] = useState(Date.now()),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        if (id) {
          const [details, board] = await Promise.all([
            api(`/contests/${id}`),
            api(`/contests/${id}/leaderboard`),
          ]);
          if (cancelled) return;
          setContest(details.contest);
          setLeaders(board.leaderboard);
          setPending(board.pending);
          setOffset(new Date(details.serverTime).getTime() - Date.now());
        } else {
          const data = await api('/contests');
          if (!cancelled) setContests(data.contests);
        }
        if (!cancelled) setError('');
      } catch (error) {
        if (!cancelled) setError(error.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    setLoading(true);
    refresh();
    const poll = setInterval(refresh, 10000),
      ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(ticker);
    };
  }, [id, user]);
  async function register() {
    if (!user) return signIn();
    setBusy(true);
    try {
      await post(`/contests/${id}/register`, {});
      const data = await api(`/contests/${id}`);
      setContest(data.contest);
      setError('');
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  const seconds = contest
    ? Math.max(
        0,
        Math.floor(
          (new Date(contest.state === 'upcoming' ? contest.startsAt : contest.endsAt).getTime() -
            now -
            offset) /
            1000,
        ),
      )
    : 0;
  const countdown = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <main className="standard-page">
      <div className="breadcrumb">
        <Link to="/">Workspace</Link>
        <span>/</span>Contests
      </div>
      {id && (
        <Link className="text-button" to="/contests">
          <ArrowLeft size={15} />
          All contests
        </Link>
      )}
      <div className="contest-heading">
        <div>
          <h1>{contest && id ? contest.title : 'Contests'}</h1>
          <p>Weekly one-hour contests for FAMT students.</p>
        </div>
        <Trophy size={64} strokeWidth={1.2} />
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading contests…</p>
      ) : id && contest ? (
        <>
          <div className="contest-meta">
            <span className={`state ${contest.state}`}>{contest.state}</span>
            <span>
              <Clock size={16} />
              60 minutes
            </span>
            <span>
              <CalendarDays size={16} />
              {new Date(contest.startsAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
            </span>
            <strong>
              {contest.state === 'finished'
                ? 'Contest ended'
                : `${contest.state === 'live' ? 'Ends in' : 'Starts in'} ${countdown}`}
            </strong>
          </div>
          {!contest.registered && contest.state !== 'finished' && (
            <button className="button primary" disabled={busy} onClick={register}>
              {busy ? 'Registering…' : 'Register for contest'}
              <ArrowRight size={16} />
            </button>
          )}
          <div className="contest-columns">
            <section className="surface">
              <h2>Contest problems</h2>
              {contest.state === 'upcoming' ? (
                <Empty title="Contest not started">
                  {contest.problems.length} problems unlock when the contest begins.
                  {contest.registered ? ' You’re registered!' : ' Register to take part.'}
                </Empty>
              ) : !contest.registered ? (
                <Empty title="Participant access">
                  Only registered participants can view this contest’s problems.
                </Empty>
              ) : (
                contest.problems.map((p, i) => (
                  <Link
                    className="contest-problem"
                    key={i}
                    to={`/problems/${p.problem.slug}?contest=${id}`}
                  >
                    <span className="problem-letter">{String.fromCharCode(65 + i)}</span>
                    <div>
                      <strong>{p.problem.title}</strong>
                      <Difficulty value={p.problem.difficulty} />
                    </div>
                    <span>{p.points} pts</span>
                    <ArrowRight size={16} />
                  </Link>
                ))
              )}
              <div className="rules">
                <h3>How scoring works</h3>
                <p>
                  Full points for each solved problem. Ties are broken by total elapsed time of your
                  first accepted submissions. Equal scores and times share a rank. Wrong attempts
                  carry no penalty.
                </p>
                <p>
                  The server’s clock is final. Submissions received before the deadline count even
                  if judging completes afterward.
                </p>
              </div>
            </section>
            <section className="surface">
              <div className="section-label">
                Leaderboard
                <Trophy size={17} />
              </div>
              <p className="muted small-text">
                Refreshes every 10 seconds{pending ? ` · ${pending} pending verdicts` : ''}
              </p>
              {!leaders.length ? (
                <Empty title="No participants yet">Registered students will appear here.</Empty>
              ) : (
                <table className="leaderboard">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Student</th>
                      <th>Score</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaders.map((row) => (
                      <tr key={row.userId}>
                        <td className="orange">#{row.rank}</td>
                        <td>{row.name}</td>
                        <td>{row.score}</td>
                        <td>
                          {Math.floor(row.penalty / 60)}m {row.penalty % 60}s
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </>
      ) : !contests.length ? (
        <Empty title="No contests scheduled">
          An administrator can schedule the first one-hour challenge. Check back here for
          registration.
        </Empty>
      ) : (
        <div className="contest-grid">
          {contests.map((c) => (
            <Link className="contest-list-card" key={c._id} to={`/contests/${c._id}`}>
              <div>
                <Trophy size={28} />
                <span className={`state ${c.state}`}>{c.state}</span>
              </div>
              <h2>{c.title}</h2>
              <p>
                {new Date(c.startsAt).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Asia/Kolkata',
                })}{' '}
                IST
              </p>
              <div className="contest-card-footer">
                <span>60 min · {c.problems.length} problems</span>
                <span>
                  {c.registered ? 'Registered' : 'View contest'}
                  <ArrowRight size={15} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
