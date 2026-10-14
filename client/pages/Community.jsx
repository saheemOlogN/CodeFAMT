import { useEffect, useState } from 'react';
import { Users, Code2 } from 'lucide-react';
import { api } from '../api.js';
import Empty from '../components/Empty.jsx';
import { useSession } from '../context/SessionContext.js';
export default function Community() {
  const [data, setData] = useState(null),
    [error, setError] = useState('');
  const { user, signIn } = useSession();
  useEffect(() => {
    api('/community')
      .then(setData)
      .catch((error) => setError(error.message));
  }, []);
  return (
    <main className="standard-page">
      <div className="contest-heading">
        <div>
          <h1>Community</h1>
          <p>Students ranked by unique problems solved.</p>
        </div>
        <Users size={64} strokeWidth={1.2} />
      </div>
      <div className="community-intro">
        <div className="surface">
          <Code2 className="orange" size={26} />
          <h2>{data ? `${data.members} college coders` : 'The FAMT coding community'}</h2>
          <p>Solve problems and participate in college contests.</p>
          {!user && (
            <button className="button primary" onClick={signIn}>
              Join with your college email
            </button>
          )}
        </div>
        <section className="surface">
          <h2>Practice leaderboard</h2>
          <p className="muted">
            Ranked by unique problems solved. Contest rankings live on each contest page.
          </p>
          {error && <p className="error-message">{error}</p>}
          {data?.leaders.length ? (
            <table className="leaderboard">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Student</th>
                  <th>Solved</th>
                </tr>
              </thead>
              <tbody>
                {data.leaders.map((student, i) => (
                  <tr key={student._id}>
                    <td>
                      #
                      {i && data.leaders[i - 1].solved === student.solved
                        ? data.leaders.findIndex((s) => s.solved === student.solved) + 1
                        : i + 1}
                    </td>
                    <td>{student.name}</td>
                    <td>{student.solved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title="No results yet">Solve a problem to join the leaderboard.</Empty>
          )}
        </section>
      </div>
    </main>
  );
}
