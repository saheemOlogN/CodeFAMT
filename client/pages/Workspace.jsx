import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import {
  ArrowLeft,
  Play,
  Send,
  RotateCcw,
  FileText,
  History,
  Terminal,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { api, post } from '../api.js';
import Difficulty from '../components/Difficulty.jsx';
import { useSession } from '../context/SessionContext.js';
import { languageOptions, starterCode } from '../../shared/catalog.js';

export default function Workspace() {
  const { slug } = useParams(),
    [params] = useSearchParams();
  const contestId = params.get('contest');
  const { user, signIn } = useSession();
  const [problem, setProblem] = useState(null),
    [error, setError] = useState('');
  const [language, setLanguage] = useState(languageOptions[0].id),
    [source, setSource] = useState(''),
    [stdin, setStdin] = useState(''),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState('description'),
    [history, setHistory] = useState([]);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    setProblem(null);
    setError('');
    api(`/problems/${slug}${contestId ? `?contest=${contestId}` : ''}`)
      .then((data) => {
        setProblem(data.problem);
        setStdin(data.problem.samples[0]?.input || '');
      })
      .catch((error) => setError(error.message));
  }, [slug, contestId, user]);
  useEffect(() => {
    setSource(localStorage.getItem(`draft:${slug}:${language}`) ?? starterCode[language]);
  }, [slug, language]);
  function updateSource(value) {
    setSource(value || '');
    localStorage.setItem(`draft:${slug}:${language}`, value || '');
  }
  useEffect(() => {
    if (tab === 'submissions' && user)
      api('/submissions')
        .then((data) => setHistory(data.submissions.filter((s) => s.problem?.slug === slug)))
        .catch((error) => setError(error.message));
  }, [tab, user, slug]);
  async function submit(kind) {
    if (!user) return signIn();
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const data = await post('/submissions', {
        slug,
        ...(contestId ? { contestId } : {}),
        requestId: crypto.randomUUID(),
        kind,
        language,
        source,
        stdin,
      });
      setResult(data.submission);
      for (let i = 0; i < 180 && active.current; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (!active.current) return;
        const next = await api(`/submissions/${data.submission._id}`);
        setResult(next.submission);
        if (!['Queued', 'Judging'].includes(next.submission.status)) return;
      }
      if (active.current)
        setError('Still in the judging queue. Check the Submissions tab for the final result.');
    } catch (error) {
      if (active.current) setError(error.message);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <main className="workspace-page">
      <div className="workspace-toolbar">
        <Link to={contestId ? `/contests/${contestId}` : '/'} className="text-button">
          <ArrowLeft size={16} />
          {contestId ? 'Back to contest' : 'Problem list'}
        </Link>
        <span>
          {problem?.pattern}
          <ChevronRight size={13} />
          {problem?.title}
        </span>
        <span className="draft-note">Drafts saved on this device</span>
      </div>
      <div className="editor-layout">
        <section className="statement-panel">
          <div className="panel-tabs">
            <button
              className={tab === 'description' ? 'active' : ''}
              onClick={() => setTab('description')}
            >
              <FileText size={15} />
              Description
            </button>
            <button
              className={tab === 'submissions' ? 'active' : ''}
              onClick={() => setTab('submissions')}
            >
              <History size={15} />
              Submissions
            </button>
          </div>
          <div className="statement-body">
            {tab === 'description' ? (
              problem ? (
                <>
                  <h1>{problem.title}</h1>
                  <div className="statement-tags">
                    <Difficulty value={problem.difficulty} />
                    <span className="tag">{problem.pattern}</span>
                    {contestId && <span className="tag">Contest problem</span>}
                  </div>
                  <p>{problem.description}</p>
                  <h3>Input format</h3>
                  <p>{problem.inputFormat}</p>
                  <h3>Output format</h3>
                  <p>{problem.outputFormat}</p>
                  {problem.samples.map((sample, i) => (
                    <div key={i} className="example">
                      <h3>Example {i + 1}</h3>
                      <div>
                        <strong>Input</strong>
                        <pre>{sample.input}</pre>
                        <strong>Output</strong>
                        <pre>{sample.output}</pre>
                      </div>
                    </div>
                  ))}
                  <h3>Constraints</h3>
                  <pre className="constraints">{problem.constraints}</pre>
                  <div className="statement-note">
                    Write a complete program that reads standard input and writes standard output.
                    Extra debug output may cause a Wrong Answer verdict.
                  </div>
                </>
              ) : (
                <p>{error || 'Loading problem…'}</p>
              )
            ) : (
              <>
                <h2>Your submissions</h2>
                {!user ? (
                  <button className="button primary" onClick={signIn}>
                    Sign in to view submissions
                  </button>
                ) : !history.length ? (
                  <p>No submissions yet.</p>
                ) : (
                  history.map((s) => (
                    <div className="submission-item" key={s._id}>
                      <span className={s.status === 'Accepted' ? 'green' : ''}>{s.status}</span>
                      <small>
                        {s.kind} · {s.language} · {new Date(s.createdAt).toLocaleString()}
                      </small>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </section>
        <section className="code-panel">
          <div className="code-toolbar">
            <span>
              <Terminal size={16} />
              Code
            </span>
            <select
              aria-label="Programming language"
              value={language}
              disabled={busy}
              onChange={(event) => setLanguage(event.target.value)}
            >
              {languageOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <button
              aria-label="Reset code to starter"
              className="icon-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Replace this draft with the starter code?'))
                  updateSource(starterCode[language]);
              }}
            >
              <RotateCcw size={15} />
            </button>
          </div>
          <div className="monaco-container">
            <Editor
              language={languageOptions.find((l) => l.id === language).editor}
              value={source}
              theme="vs-dark"
              onChange={updateSource}
              loading={
                <textarea
                  className="code-fallback"
                  aria-label="Source code"
                  spellCheck={false}
                  value={source}
                  onChange={(event) => updateSource(event.target.value)}
                />
              }
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                fontFamily: "'Cascadia Code', Consolas, monospace",
                padding: { top: 20 },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 4,
                readOnly: busy,
              }}
            />
          </div>
          <div className="testcase-panel">
            <div className="panel-tabs">
              <span>
                <Terminal size={14} />
                Testcase & result
              </span>
              {result && (
                <span
                  className={`result-status ${['Accepted', 'Executed'].includes(result.status) ? 'green' : ''}`}
                >
                  {result.status === 'Accepted' && <CheckCircle2 size={14} />}
                  {result.status}
                </span>
              )}
            </div>
            <div className="testcase-body">
              <label>
                Standard input
                <textarea
                  rows={3}
                  value={stdin}
                  onChange={(event) => setStdin(event.target.value)}
                  placeholder="Enter custom input"
                />
              </label>
              {result && !['Queued', 'Judging'].includes(result.status) && (
                <div className="result-box">
                  <strong>{result.status}</strong>
                  {result.kind === 'submit' && (
                    <span>
                      {' '}
                      · {result.passed}/{result.total} tests · {result.runtime ?? 0} ms
                    </span>
                  )}
                  {result.kind === 'run' && (
                    <>
                      <pre>{result.output || '(No output)'}</pre>
                      {result.error && <pre className="error-message">{result.error}</pre>}
                    </>
                  )}
                  {result.status === 'System Error' && <p>{result.error}</p>}
                </div>
              )}
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
          <div className="editor-actions">
            <span>{busy ? 'Judging your code…' : ''}</span>
            <button
              className="button secondary"
              disabled={busy || !problem}
              onClick={() => submit('run')}
            >
              <Play size={15} />
              Run
            </button>
            <button
              className="button submit"
              disabled={busy || !problem}
              onClick={() => submit('submit')}
            >
              <Send size={15} />
              Submit
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
