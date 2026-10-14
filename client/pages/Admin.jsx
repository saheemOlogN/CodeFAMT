import { useEffect, useState } from 'react';
import { api, post } from '../api.js';
import Empty from '../components/Empty.jsx';
import { useSession } from '../context/SessionContext.js';
import { patterns } from '../../shared/catalog.js';
import TestCaseFields from '../components/TestCaseFields.jsx';
const blank = {
  slug: '',
  title: '',
  difficulty: 'Easy',
  pattern: patterns[0],
  description: '',
  inputFormat: '',
  outputFormat: '',
  constraints: '',
  published: false,
};
export default function Admin() {
  const { user, signIn } = useSession();
  const [problems, setProblems] = useState([]),
    [draft, setDraft] = useState(blank),
    [editing, setEditing] = useState(null),
    [samples, setSamples] = useState([{ input: '', output: '' }]),
    [tests, setTests] = useState([{ input: '', output: '' }]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [contestTitle, setContestTitle] = useState(''),
    [start, setStart] = useState(''),
    [selected, setSelected] = useState({});
  const refresh = () => api('/admin/problems').then((data) => setProblems(data.problems));
  useEffect(() => {
    if (user?.admin) refresh().catch((error) => setMessage(error.message));
  }, [user]);
  if (!user)
    return (
      <Empty title="Admin sign-in">
        <button className="button primary" onClick={signIn}>
          Sign in
        </button>
      </Empty>
    );
  if (!user.admin)
    return (
      <Empty title="Admin access required">
        Your account does not have permission to manage problems or contests.
      </Empty>
    );
  async function saveProblem(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api(`/admin/problems${editing ? `/${editing}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...draft,
          samples,
          testCases: tests,
        }),
      });
      setDraft(blank);
      setEditing(null);
      setSamples([{ input: '', output: '' }]);
      setTests([{ input: '', output: '' }]);
      await refresh();
      setMessage('Problem saved.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveContest(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await post('/admin/contests', {
        title: contestTitle,
        startsAt: new Date(start).toISOString(),
        problems: Object.entries(selected).map(([problem, points]) => ({
          problem,
          points: Number(points),
        })),
      });
      setContestTitle('');
      setSelected({});
      setMessage('One-hour contest scheduled. Students can now register.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="standard-page">
      <h1>Admin</h1>
      <p className="muted">Manage problems and schedule contests.</p>
      {message && (
        <div role="status" className="notice">
          {message}
        </div>
      )}
      <div className="admin-columns">
        <section className="surface">
          <h2>{editing ? 'Edit problem' : 'Create problem'}</h2>
          <form className="admin-form" onSubmit={saveProblem}>
            {['title', 'slug'].map((key) => (
              <label key={key}>
                {key}
                <input
                  required
                  value={draft[key]}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                />
              </label>
            ))}
            <div className="form-row">
              <label>
                Difficulty
                <select
                  value={draft.difficulty}
                  onChange={(event) => setDraft({ ...draft, difficulty: event.target.value })}
                >
                  {['Easy', 'Medium', 'Hard'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                Pattern
                <select
                  value={draft.pattern}
                  onChange={(event) => setDraft({ ...draft, pattern: event.target.value })}
                >
                  {patterns.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>
            {['description', 'inputFormat', 'outputFormat', 'constraints'].map((key) => (
              <label key={key}>
                {key.replace(/([A-Z])/g, ' $1')}
                <textarea
                  required
                  rows={3}
                  value={draft[key]}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                />
              </label>
            ))}
            <TestCaseFields
              title="Public examples"
              cases={samples}
              onChange={setSamples}
              maximum={5}
            />
            <TestCaseFields title="Hidden tests" cases={tests} onChange={setTests} maximum={30} />
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.published}
                onChange={(event) => setDraft({ ...draft, published: event.target.checked })}
              />
              Publish in practice library
            </label>
            <p className="small-text muted">
              Keep contest questions as drafts. Include public samples in the hidden test suite if
              you want them judged on submission.
            </p>
            <button className="button primary" disabled={busy}>
              Save problem
            </button>
            {editing && (
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setEditing(null);
                  setDraft(blank);
                  setSamples([{ input: '', output: '' }]);
                  setTests([{ input: '', output: '' }]);
                }}
              >
                Cancel edit
              </button>
            )}
          </form>
        </section>
        <div>
          <section className="surface">
            <h2>Schedule a contest</h2>
            <form className="admin-form" onSubmit={saveContest}>
              <label>
                Contest title
                <input
                  required
                  placeholder="CodeFAMT Weekly #01"
                  value={contestTitle}
                  onChange={(event) => setContestTitle(event.target.value)}
                />
              </label>
              <label>
                Start time (your browser’s local time)
                <input
                  required
                  type="datetime-local"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </label>
              <p className="small-text muted">
                Duration: exactly 60 minutes. Select 1–6 unused draft problems.
              </p>
              {problems
                .filter((p) => !p.published)
                .map((p) => (
                  <div className="contest-selection" key={p._id}>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={p._id in selected}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = { ...current };
                            if (event.target.checked) next[p._id] = 100;
                            else delete next[p._id];
                            return next;
                          })
                        }
                      />
                      {p.title}
                    </label>
                    {p._id in selected && (
                      <input
                        aria-label={`Points for ${p.title}`}
                        type="number"
                        min={1}
                        max={1000}
                        value={selected[p._id]}
                        onChange={(event) =>
                          setSelected({ ...selected, [p._id]: event.target.value })
                        }
                      />
                    )}
                  </div>
                ))}
              <button className="button primary" disabled={busy || !Object.keys(selected).length}>
                Schedule contest
              </button>
            </form>
          </section>
          <section className="surface admin-library">
            <h2>Problem library</h2>
            {problems.map((p) => (
              <button
                className="admin-problem"
                key={p._id}
                onClick={() => {
                  setEditing(p._id);
                  setDraft(Object.fromEntries(Object.keys(blank).map((key) => [key, p[key]])));
                  setSamples(p.samples.map(({ input, output }) => ({ input, output })));
                  setTests(p.testCases.map(({ input, output }) => ({ input, output })));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                <span>{p.title}</span>
                <span className="tag">{p.published ? 'Published' : 'Draft'}</span>
              </button>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}
