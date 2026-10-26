import DsaEditor from '../components/DsaEditor'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Code2, FileText, LockKeyhole, Plus, Save, ShieldCheck, Trash2, Trophy, Upload, X } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../context/auth'
import Dialog from '../components/Dialog'
import './AdminPage.css'

const newProblem = { dsa: [], title: '', slug: '', statement: '', difficulty: 'easy', tags: '', inputFormat: '', outputFormat: '', constraints: '', examples: [], timeLimitMs: 1000, memoryLimitMb: 256, visibility: 'draft' }
const newContest = { title: '', description: '', startTime: '', endTime: '', problems: [], status: 'draft' }
const dateLabel = (value) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const localDate = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

async function allRecords(path, key, token, signal) {
  const records = []
  let page = 1
  let total = 0
  do {
    const result = await api(`${path}?limit=100&page=${page}`, { token, signal })
    records.push(...result[key])
    total = result.total
    page += 1
    if (!result[key].length) break
  } while (records.length < total)
  return records
}

function Status({ value }) {
  return <span className={`admin-status admin-status-${value}`}>{value === 'contest' ? 'Contest only' : value}</span>
}

function Feedback({ error, message }) {
  return <>{error && <p className="notice notice-error" role="alert">{error}</p>}{message && <p className="notice notice-success" role="status">{message}</p>}</>
}

function Confirmation({ children, action, onCancel, busy, danger = false }) {
  return <div className={`admin-confirm ${danger ? 'admin-confirm-danger' : ''}`} role="group" aria-label="Confirm action">
    <p>{children}</p><div className="admin-actions">{action}<button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Keep editing</button></div>
  </div>
}

export default function AdminPage() {
  const { token } = useAuth()
  const [tab, setTab] = useState('contests')
  const [page, setPage] = useState(1)
  const [visibility, setVisibility] = useState('')
  const [selection, setSelection] = useState(null)
  const [editorBusy, setEditorBusy] = useState(false)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const newButtonRef = useRef(null)

  useEffect(() => { document.title = 'Administration | CodeFAMT' }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api(`/${tab}?page=${page}&limit=20${tab === 'problems' && visibility ? `&visibility=${visibility}` : ''}`, { token, signal: controller.signal })
      .then((result) => { setRows(result[tab] || []); setTotal(result.total) })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [tab, page, visibility, token, revision])

  function changeTab(next) { setTab(next); setPage(1); setSelection(null) }
  function refresh(item) { setRevision((value) => value + 1); if (item) setSelection(item._id) }
  function deleted() { setRows((current) => current.filter((item) => item._id !== selection)); setSelection(null); setPage(1); refresh() }

  return <section className="admin-page">
    <header className="admin-heading">
      <h1>Administration</h1>
      <button ref={newButtonRef} className="primary-button" onClick={() => { setTab('contests'); setPage(1); setSelection('new') }}><Plus size={16} /> New contest</button>
    </header>
    <div className="admin-tabs" role="tablist" aria-label="Content type">
      <button id="admin-problems-tab" role="tab" aria-selected={tab === 'problems'} aria-controls="admin-content" onClick={() => changeTab('problems')}><Code2 size={16} /> Problems</button>
      <button id="admin-contests-tab" role="tab" aria-selected={tab === 'contests'} aria-controls="admin-content" onClick={() => changeTab('contests')}><Trophy size={16} /> Contests</button>
    </div>
    <div id="admin-content" role="tabpanel" aria-labelledby={`admin-${tab}-tab`}>
        <div className="admin-list-toolbar"><h2>{tab === 'problems' ? 'Problem library' : 'Contest schedule'} <span>{loading ? '' : total}</span></h2>
          {tab === 'problems' && <label className="admin-filter"><span>Visibility</span><select value={visibility} onChange={(event) => { setVisibility(event.target.value); setPage(1) }}><option value="">All problems</option><option value="draft">Draft</option><option value="contest">Contest only</option><option value="public">Public</option></select></label>}
        </div>
        <Feedback error={error} />
        {error ? <button className="secondary-button" onClick={() => refresh()}>Try again</button> : loading ? <div className="admin-empty" role="status">Loading {tab}...</div> : !rows.length ? <div className="admin-empty"><FileText size={32} /><h3>No {tab} yet</h3><button className="secondary-button" onClick={() => { setTab('contests'); setSelection('new') }}><Plus size={16} /> Create contest</button></div> : <>
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{tab === 'problems' ? 'Problem' : 'Contest'}</th><th>{tab === 'problems' ? 'Difficulty' : 'Starts'}</th><th>Status</th><th><span className="admin-sr-only">Open</span></th></tr></thead><tbody>{rows.map((row) => <tr key={row._id}>
            <td><button className="admin-row-title" onClick={() => setSelection(row._id)}>{row.title}</button>{tab === 'problems' && <span className="admin-row-secondary">{row.slug}</span>}</td>
            <td>{tab === 'problems' ? <Status value={row.difficulty} /> : <span className="admin-date">{dateLabel(row.startTime)}</span>}</td><td><Status value={row.visibility || row.status} /></td>
            <td><button className="admin-icon-button" aria-label={`Open ${row.title}`} title={`Open ${row.title}`} onClick={() => setSelection(row._id)}><ChevronRight size={18} /></button></td>
          </tr>)}</tbody></table></div>
          <div className="admin-pagination"><span>{(page - 1) * 20 + 1}-{Math.min(page * 20, total)} of {total}</span><div className="admin-actions"><button className="admin-icon-button" disabled={page === 1} aria-label="Previous page" title="Previous page" onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button><span>Page {page}</span><button className="admin-icon-button" disabled={page * 20 >= total} aria-label="Next page" title="Next page" onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button></div></div>
        </>}
    </div>
    {selection && <Dialog title={`${selection === 'new' ? 'New' : 'Edit'} ${tab === 'problems' ? 'problem' : 'contest'}`} busy={editorBusy} fallbackFocusRef={newButtonRef} onClose={() => setSelection(null)}>
      {tab === 'problems' ? <ProblemEditor key={selection} id={selection} token={token} onSaved={refresh} onDeleted={deleted} onBusyChange={setEditorBusy} /> : <ContestEditor key={selection} id={selection} token={token} onSaved={refresh} onDeleted={deleted} onBusyChange={setEditorBusy} />}
    </Dialog>}
  </section>
}

function ProblemEditor({ id, token, onSaved, onDeleted, onBusyChange, contestWorkflow = false }) {
  const [values, setValues] = useState({ ...newProblem })
  const [loading, setLoading] = useState(id !== 'new')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [testCount, setTestCount] = useState(null)
  const [legacyTemplates, setLegacyTemplates] = useState([])
  const [testPending, setTestPending] = useState(false)
  const [testSaving, setTestSaving] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [retry, setRetry] = useState(0)
  const locked = values.visibility !== 'draft'

  useEffect(() => { onBusyChange(busy || testSaving); return () => onBusyChange(false) }, [busy, testSaving, onBusyChange])

  useEffect(() => {
    if (id === 'new') return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api(`/problems/${id}`, { token, signal: controller.signal }).then(({ problem }) => setValues({ ...problem, tags: problem.tags.join(', ') }))
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, token, retry])

  const update = (field, value) => setValues((current) => ({ ...current, [field]: value }))
  function updateExample(index, field, value) { update('examples', values.examples.map((example, i) => i === index ? { ...example, [field]: value } : example)) }

  async function save(event) {
    event.preventDefault()
    const publish = event.nativeEvent.submitter?.value
    setBusy(true); setError(''); setMessage('')
    try {
      const body = Object.fromEntries(Object.keys(newProblem).map((key) => [key, values[key]]))
      body.title = body.title.trim()
      body.slug = body.slug.trim().toLowerCase()
      body.tags = [...new Set(values.tags.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean))]
      body.timeLimitMs = Number(values.timeLimitMs)
      body.memoryLimitMb = Number(values.memoryLimitMb)
      body.visibility = publish === 'public' || publish === 'contest' ? publish : 'draft'
      const { problem } = await api(id === 'new' ? '/problems' : `/problems/${id}`, { token, method: id === 'new' ? 'POST' : 'PATCH', body })
      setValues({ ...problem, tags: problem.tags.join(', ') })
      setConfirm(''); setMessage(body.visibility === 'draft' ? 'Problem draft saved.' : 'Problem published.')
      onSaved(problem)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  async function configureLegacy(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const { problem } = await api(`/problems/${id}`, { token, method: 'PATCH', body: { dsa: legacyTemplates } })
      setValues({ ...problem, tags: problem.tags.join(', ') }); setMessage('Function templates configured.'); onSaved(problem)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  async function remove() {
    setBusy(true); setError(''); setMessage('')
    try { await api(`/problems/${id}`, { token, method: 'DELETE' }); onDeleted() } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  if (loading) return <div className="admin-empty" role="status">Loading problem...</div>
  if (id !== 'new' && !values._id) return <><Feedback error={error} /><button className="secondary-button" onClick={() => setRetry((value) => value + 1)}>Try again</button></>

  return <div className="admin-editor">
    {id !== 'new' && <div className="admin-editor-meta"><span>{values.slug}</span><Status value={values.visibility} /></div>}
    <Feedback error={error} message={message} />
    {locked && <div className="admin-lock"><LockKeyhole size={16} /> Published problem and test cases are locked.</div>}
    {locked && !values.dsa?.length && <form onSubmit={configureLegacy}><fieldset disabled={busy}><p className="notice">This older problem needs function templates before students can run or submit new solutions.</p><DsaEditor value={legacyTemplates} onChange={setLegacyTemplates} /><button type="submit" className="primary-button" disabled={!legacyTemplates.length}>Enable function solutions</button></fieldset></form>}
    <form onSubmit={save}>
      <fieldset disabled={busy || locked} className="admin-form-body">
        <section className="admin-form-section"><div className="admin-section-heading"><h3>Problem details</h3></div>
          <div className="admin-field-grid"><label>Title<input required value={values.title} onChange={(event) => update('title', event.target.value)} /></label><label>Slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" title="Lowercase letters, numbers, and single hyphens" value={values.slug} onChange={(event) => update('slug', event.target.value)} /></label></div>
          <div className="admin-field-grid"><label>Difficulty<select value={values.difficulty} onChange={(event) => update('difficulty', event.target.value)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label><label>Tags<input value={values.tags} placeholder="arrays, sorting" onChange={(event) => update('tags', event.target.value)} /></label></div>
          <label>Statement<textarea required rows={6} value={values.statement} onChange={(event) => update('statement', event.target.value)} /></label>
          <div className="admin-field-grid"><label>Function arguments / test input<textarea required rows={3} value={values.inputFormat} onChange={(event) => update('inputFormat', event.target.value)} /></label><label>Return value / expected output<textarea required rows={3} value={values.outputFormat} onChange={(event) => update('outputFormat', event.target.value)} /></label></div>
          <label>Constraints<textarea required rows={3} value={values.constraints} onChange={(event) => update('constraints', event.target.value)} /></label>
          <div className="admin-field-grid"><label>Time limit (ms)<input type="number" min="1" step="1" required value={values.timeLimitMs} onChange={(event) => update('timeLimitMs', event.target.value)} /></label><label>Memory limit (MB)<input type="number" min="1" step="1" required value={values.memoryLimitMb} onChange={(event) => update('memoryLimitMb', event.target.value)} /></label></div>
        </section>
        <section className="admin-form-section"><div className="admin-section-heading"><h3>Examples <span>{values.examples.length}</span></h3>{!locked && <button className="secondary-button" type="button" onClick={() => update('examples', [...values.examples, { input: '', output: '', explanation: '' }])}><Plus size={15} /> Add example</button>}</div>
          {!values.examples.length && <p className="admin-subtle">No examples added.</p>}
          {values.examples.map((example, index) => <div className="admin-example" key={index}><div className="admin-section-heading"><h4>Example {index + 1}</h4>{!locked && <button type="button" className="admin-icon-button admin-danger" title={`Remove example ${index + 1}`} aria-label={`Remove example ${index + 1}`} onClick={() => update('examples', values.examples.filter((_, i) => i !== index))}><Trash2 size={15} /></button>}</div>
            <div className="admin-field-grid"><label>Input<textarea className="admin-code" rows={3} value={example.input} onChange={(event) => updateExample(index, 'input', event.target.value)} /></label><label>Output<textarea className="admin-code" rows={3} value={example.output} onChange={(event) => updateExample(index, 'output', event.target.value)} /></label></div><label>Explanation<textarea rows={2} value={example.explanation} onChange={(event) => updateExample(index, 'explanation', event.target.value)} /></label>
          </div>)}
        </section>
        <DsaEditor value={values.dsa || []} onChange={value => update('dsa', value)} locked={locked} />
        {!locked && <div className="admin-editor-actions"><button className="primary-button" type="submit"><Save size={16} />{busy ? 'Saving...' : 'Save draft'}</button>
          {id !== 'new' && !contestWorkflow && <><div className="admin-actions"><button className="secondary-button" type="button" disabled={!testCount || testPending} onClick={() => setConfirm('public')}><Upload size={15} /> Publish to library</button><button className="secondary-button" type="button" disabled={!testCount || testPending} onClick={() => setConfirm('contest')}><Trophy size={15} /> Publish for contests</button></div><button className="admin-icon-button admin-danger" type="button" disabled={testCount !== 0 || testPending} title={testCount ? 'Delete all hidden tests before deleting this draft' : 'Delete problem draft'} aria-label="Delete problem draft" onClick={() => setConfirm('delete')}><Trash2 size={17} /></button></>}
        </div>}
        {(confirm === 'public' || confirm === 'contest') && <Confirmation busy={busy} onCancel={() => setConfirm('')} action={<button type="submit" value={confirm} disabled={!testCount || testPending} className="primary-button"><Check size={16} /> Confirm publication</button>}>Publish {confirm === 'public' ? 'to the public problem library' : 'for contest use'}? The problem and its hidden tests will become permanently locked. Current edits will be saved.</Confirmation>}
      </fieldset>
    </form>
    {confirm === 'delete' && <Confirmation busy={busy} danger onCancel={() => setConfirm('')} action={<button type="button" className="secondary-button admin-danger" disabled={busy} onClick={remove}><Trash2 size={16} /> Delete draft</button>}>Delete this problem draft permanently?</Confirmation>}
    {id !== 'new' && <HiddenTests problemId={id} token={token} locked={locked || busy} onCount={setTestCount} onPending={setTestPending} onSaving={setTestSaving} />}
  </div>
}

function HiddenTests({ problemId, token, locked, onCount, onPending, onSaving }) {
  const [tests, setTests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState(null)
  const [values, setValues] = useState({ input: '', expectedOutput: '' })
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [revision, setRevision] = useState(0)
  const editorRef = useRef(null)
  const [importPreview, setImportPreview] = useState(null)

  useEffect(() => { onPending(Boolean(editing) || Boolean(importPreview) || busy || loading) }, [editing, importPreview, busy, loading, onPending])
  useEffect(() => { onSaving(busy) }, [busy, onSaving])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    api(`/problems/${problemId}/tests?limit=100`, { token, signal: controller.signal }).then((data) => { setTests(data.testCases); onCount(data.total); setError('') })
      .catch((failure) => { if (!controller.signal.aborted) { setError(failure.message); onCount(null) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [problemId, token, onCount, revision])

  function edit(test) { setEditing(test?._id || 'new'); setValues({ input: test?.input ?? '', expectedOutput: test?.expectedOutput ?? '' }); setConfirm(null); setMessage(''); requestAnimationFrame(() => editorRef.current?.focus()) }

  async function save(event) {
    event.preventDefault()
    setError(''); setMessage('')
    const encoder = new TextEncoder()
    if (values.input.includes('\0') || values.expectedOutput.includes('\0') || encoder.encode(values.input).length > 100000 || encoder.encode(values.expectedOutput).length > 65536) {
      setError('Input must be at most 100,000 bytes and expected output at most 65,536 bytes, without NUL characters.'); return
    }
    setBusy(true)
    try {
      const { testCase } = await api(`/problems/${problemId}/tests${editing === 'new' ? '' : `/${editing}`}`, { token, method: editing === 'new' ? 'POST' : 'PATCH', body: values })
      const next = editing === 'new' ? [...tests, testCase] : tests.map((test) => test._id === editing ? testCase : test)
      setTests(next); onCount(next.length); setEditing(null); setMessage('Hidden test saved.')
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  async function readFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(''); setMessage(''); setImportPreview(null)
    try {
      if (file.size > 750000) throw new Error('Use a JSON file up to 750,000 bytes.')
      const parsed = JSON.parse(await file.text())
      const imported = Array.isArray(parsed) ? parsed : parsed.testCases
      if (!Array.isArray(imported) || !imported.length || imported.length + tests.length > 100) throw new Error('Upload 1–100 tests. Existing tests plus imported tests must not exceed 100.')
      const encoder = new TextEncoder()
      imported.forEach((item, i) => {
        if (!item || Array.isArray(item) || Object.keys(item).some(key => !['input', 'expectedOutput'].includes(key)) || ['input', 'expectedOutput'].some(key => typeof item[key] !== 'string' || item[key].includes('\0') || encoder.encode(item[key]).length > (key === 'input' ? 100000 : 65536))) throw new Error(`Test ${i + 1} needs string input and expectedOutput within the size limits.`)
      })
      setImportPreview(imported)
    } catch (failure) { setError(failure instanceof SyntaxError ? 'Invalid JSON. Download the example to check the format.' : failure.message) }
  }
  async function importTests() {
    setBusy(true); setError('')
    try {
      const result = await api(`/problems/${problemId}/tests/import`, { token, method: 'POST', body: { testCases: importPreview } })
      setImportPreview(null); setMessage(`${result.imported} tests imported.`); setRevision(value => value + 1)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  async function remove(id) {
    setBusy(true); setError(''); setMessage('')
    try { await api(`/problems/${problemId}/tests/${id}`, { token, method: 'DELETE' }); const next = tests.filter((test) => test._id !== id); setTests(next); onCount(next.length); setConfirm(null); if (editing === id) setEditing(null); setMessage('Hidden test deleted.') } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  return <section className="admin-form-section admin-tests"><div className="admin-section-heading"><h3><ShieldCheck size={17} /> Hidden tests <span>{tests.length}/100</span></h3>{!locked && <button type="button" className="secondary-button" disabled={loading || busy || tests.length >= 100} onClick={() => edit(null)}><Plus size={15} /> Add test</button>}</div>
    <Feedback error={error} message={message} />
    {!locked && <div className="admin-import"><label>Import test cases (.json)<input type="file" accept=".json,application/json" disabled={busy || loading || Boolean(editing)} onChange={readFile} /></label><a className="text-button" href="/test-cases.example.json" download>Download example JSON</a><p className="admin-subtle">Appends tests without replacing existing ones. Each test contains string input and expectedOutput matching the hidden driver. Maximum 100 tests per problem.</p></div>}
    {importPreview && !locked && <div className="admin-confirm"><p>{importPreview.length} tests ready to import. {tests.length} existing tests will be kept.</p><pre className="admin-code">{JSON.stringify(importPreview.slice(0, 2), null, 2)}</pre><div className="admin-actions"><button className="primary-button" disabled={busy} onClick={importTests}>Import {importPreview.length} tests</button><button className="secondary-button" disabled={busy} onClick={() => setImportPreview(null)}>Cancel import</button></div></div>}
    {loading ? <p className="admin-subtle" role="status">Loading hidden tests...</p> : !tests.length ? <p className="admin-subtle">No hidden tests. At least one is required for publication.</p> : <div className="admin-test-list">{tests.map((test, index) => <div className="admin-test-row" key={test._id}><span className="admin-test-number">{String(index + 1).padStart(2, '0')}</span><div className="admin-test-preview"><span>Input</span><code>{test.input || '(empty)'}</code></div><div className="admin-test-preview"><span>Expected output</span><code>{test.expectedOutput || '(empty)'}</code></div>
      {!locked && <div className="admin-actions"><button className="secondary-button" disabled={busy} onClick={() => edit(test)}>Edit</button><button className="admin-icon-button admin-danger" disabled={busy} title={`Delete test ${index + 1}`} aria-label={`Delete test ${index + 1}`} onClick={() => { setConfirm(test._id); setEditing(null) }}><Trash2 size={15} /></button></div>}
      {confirm === test._id && <Confirmation danger busy={busy} onCancel={() => setConfirm(null)} action={<button className="secondary-button admin-danger" disabled={busy} onClick={() => remove(test._id)}>Delete test</button>}>Delete hidden test {index + 1}?</Confirmation>}
    </div>)}</div>}
    {error && !loading && <button className="admin-back" onClick={() => setRevision((value) => value + 1)}>Reload tests</button>}
    {editing && !locked && <form className="admin-test-editor" onSubmit={save}><fieldset disabled={busy}><div className="admin-section-heading"><h4>{editing === 'new' ? 'New hidden test' : 'Edit hidden test'}</h4><button className="admin-icon-button" aria-label="Close test editor" title="Close test editor" type="button" onClick={() => setEditing(null)}><X size={17} /></button></div><div className="admin-field-grid"><label>Input<textarea ref={editorRef} className="admin-code" rows={5} value={values.input} onChange={(event) => setValues({ ...values, input: event.target.value })} /></label><label>Expected output<textarea className="admin-code" rows={5} value={values.expectedOutput} onChange={(event) => setValues({ ...values, expectedOutput: event.target.value })} /></label></div><button type="submit" className="primary-button"><Save size={16} /> {busy ? 'Saving...' : 'Save test'}</button></fieldset></form>}
  </section>
}

function ContestEditor({ id, token, onSaved, onDeleted, onBusyChange }) {
  const [values, setValues] = useState({ ...newContest })
  const [options, setOptions] = useState([])
  const [usedProblems, setUsedProblems] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirm, setConfirm] = useState('')
  const [candidate, setCandidate] = useState('')
  const [creatingProblem, setCreatingProblem] = useState(null)
  const [problemBusy, setProblemBusy] = useState(false)
  const handleProblemBusy = useCallback(value => { setProblemBusy(value); onBusyChange(value) }, [onBusyChange])
  const [retry, setRetry] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [serverOffset, setServerOffset] = useState(0)
  const [now, setNow] = useState(Date.now)
  const locked = values.status !== 'draft'
  const update = (field, value) => setValues((current) => ({ ...current, [field]: value }))

  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) }, [busy, onBusyChange])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    async function load() {
      const [problems, contests, current] = await Promise.all([
        allRecords('/problems', 'problems', token, controller.signal),
        allRecords('/contests', 'contests', token, controller.signal),
        id === 'new' ? Promise.resolve(null) : api(`/contests/${id}`, { token, signal: controller.signal }),
      ])
      const published = await Promise.all(contests.filter((contest) => contest.status === 'published' && contest._id !== id).map((contest) => api(`/contests/${contest._id}`, { token, signal: controller.signal })))
      if (controller.signal.aborted) return
      setOptions(problems)
      setUsedProblems(new Set(published.flatMap(({ contest }) => contest.problems.map((entry) => entry.problem?._id).filter(Boolean))))
      if (current) {
        setValues({ ...current.contest, startTime: localDate(current.contest.startTime), endTime: localDate(current.contest.endTime), problems: (current.contest.problems || []).map((entry) => ({ problem: entry.problem?._id || '', points: entry.points, title: entry.problem?.title || 'Unavailable problem' })) })
        setServerOffset(new Date(current.serverNow).getTime() - Date.now())
      }
      setLoaded(true)
    }
    load().catch((failure) => { if (!controller.signal.aborted) setError(failure.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, token, retry])

  const available = options.filter((problem) => ['draft', 'contest'].includes(problem.visibility) && !usedProblems.has(problem._id) && !values.problems.some((entry) => entry.problem === problem._id))
  const canPublish = values.problems.length > 0 && values.problems.every((entry) => ['draft', 'contest'].includes(options.find((problem) => problem._id === entry.problem)?.visibility) && !usedProblems.has(entry.problem))
  const canCancel = values.status === 'published' && new Date(values.startTime).getTime() > now + serverOffset

  async function save(event) {
    event.preventDefault()
    setError(''); setMessage('')
    if (new Date(values.endTime) <= new Date(values.startTime)) { setError('The contest must end after its start time.'); return }
    const publishing = event.nativeEvent.submitter?.value === 'published'
    if (publishing && new Date(values.startTime).getTime() <= Date.now() + serverOffset) { setError('Publish the contest before its start time.'); return }
    const problems = values.problems.map(({ problem, points }) => ({ problem, points: Number(points) }))
    if (problems.some((entry) => !Number.isSafeInteger(entry.points) || entry.points < 1) || !Number.isSafeInteger(problems.reduce((sum, entry) => sum + entry.points, 0))) { setError('Problem points and the total score must be positive safe integers.'); return }
    setBusy(true)
    try {
      const { contest } = await api(id === 'new' ? '/contests' : `/contests/${id}`, { token, method: id === 'new' ? 'POST' : 'PATCH', body: { title: values.title.trim(), description: values.description, startTime: new Date(values.startTime).toISOString(), endTime: new Date(values.endTime).toISOString(), problems, status: publishing ? 'published' : 'draft' } })
      setValues((current) => ({ ...current, status: contest.status })); setConfirm(''); setMessage(publishing ? 'Contest published.' : 'Contest draft saved.'); onSaved(contest)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  async function changeStatus(action) {
    setBusy(true); setError(''); setMessage('')
    try {
      if (action === 'delete') { await api(`/contests/${id}`, { token, method: 'DELETE' }); onDeleted() }
      else { const { contest } = await api(`/contests/${id}`, { token, method: 'PATCH', body: { status: 'cancelled' } }); update('status', contest.status); setConfirm(''); setMessage('Contest cancelled.'); onSaved(contest) }
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  if (loading) return <div className="admin-empty" role="status">Loading contest...</div>
  if (!loaded) return <><Feedback error={error} /><button className="secondary-button" onClick={() => setRetry((value) => value + 1)}>Try again</button></>

  if (creatingProblem) return <div>
    <button type="button" className="secondary-button" disabled={problemBusy} onClick={() => setCreatingProblem(null)}><ChevronLeft size={16} /> Back to contest</button>
    <p className="admin-subtle">Save the problem draft, add function templates and upload its tests. The same problem enters the practice library after the contest ends.</p>
    <ProblemEditor key={creatingProblem} id={creatingProblem} token={token} contestWorkflow onBusyChange={handleProblemBusy} onDeleted={() => setCreatingProblem(null)} onSaved={problem => {
      setOptions(current => [...current.filter(item => item._id !== problem._id), problem])
      setValues(current => ({ ...current, problems: current.problems.some(item => item.problem === problem._id) ? current.problems : [...current.problems, { problem: problem._id, points: 100 }] }))
      setCreatingProblem(problem._id)
    }} />
  </div>

  return <div className="admin-editor">{id !== 'new' && <div className="admin-editor-meta"><span>{values.problems.length} problems · {values.problems.reduce((sum, entry) => sum + Number(entry.points || 0), 0)} points</span><Status value={values.status} /></div>}
    <Feedback error={error} message={message} />
    {locked && <div className="admin-lock"><LockKeyhole size={16} /> {values.status === 'cancelled' ? 'This contest has been cancelled.' : 'Published contest details are locked.'}</div>}
    <form onSubmit={save}><fieldset disabled={busy || locked} className="admin-form-body"><section className="admin-form-section"><div className="admin-section-heading"><h3>Contest details</h3></div><label>Title<input required value={values.title} onChange={(event) => update('title', event.target.value)} /></label><label>Description<textarea rows={4} value={values.description} onChange={(event) => update('description', event.target.value)} /></label><div className="admin-field-grid"><label>Starts (local time)<input required type="datetime-local" value={values.startTime} onChange={(event) => update('startTime', event.target.value)} /></label><label>Ends (local time)<input required type="datetime-local" value={values.endTime} onChange={(event) => update('endTime', event.target.value)} /></label></div></section>
      <section className="admin-form-section"><div className="admin-section-heading"><h3>Contest problems <span>{values.problems.length}/20</span></h3>{!locked && <button type="button" className="secondary-button" disabled={values.problems.length >= 20} onClick={() => setCreatingProblem('new')}><Plus size={16} /> Create problem</button>}</div><p className="admin-subtle">Create problems here or attach an unused draft. Publishing locks their tests and opens practice access automatically when the contest ends.</p>
        {values.problems.length ? <div className="admin-contest-problems">{values.problems.map((entry, index) => { const problem = options.find((item) => item._id === entry.problem); return <div className="admin-contest-problem" key={entry.problem || index}><span className="admin-test-number">{String.fromCharCode(65 + index)}</span><div className="admin-selected-problem"><strong>{problem?.title || entry.title}</strong><div><Status value={problem?.visibility || 'unavailable'} />{usedProblems.has(entry.problem) && <span className="admin-danger">Already used in a published contest</span>}</div></div><label>Points<input required type="number" min="1" step="1" max={Number.MAX_SAFE_INTEGER} value={entry.points} onChange={(event) => update('problems', values.problems.map((item, i) => index === i ? { ...item, points: event.target.value } : item))} /></label>{!locked && <button type="button" className="secondary-button" onClick={() => setCreatingProblem(entry.problem)}>Edit problem</button>}{!locked && <button type="button" className="admin-icon-button admin-danger" title={`Remove ${problem?.title || 'problem'}`} aria-label={`Remove ${problem?.title || 'problem'}`} onClick={() => update('problems', values.problems.filter((_, i) => i !== index))}><X size={17} /></button>}</div> })}</div> : <p className="admin-subtle">No problems selected.</p>}
        {!locked && <div className="admin-problem-picker"><label>Add a contest problem<select value={candidate} disabled={values.problems.length >= 20} onChange={(event) => setCandidate(event.target.value)}><option value="">{available.length ? 'Select a problem' : 'No eligible problems available'}</option>{available.map((problem) => <option key={problem._id} value={problem._id}>{problem.title} ({problem.difficulty})</option>)}</select></label><button type="button" className="secondary-button" disabled={!candidate || values.problems.length >= 20} onClick={() => { update('problems', [...values.problems, { problem: candidate, points: 100 }]); setCandidate('') }}><Plus size={16} /> Add problem</button></div>}
      </section>
      {!locked && <div className="admin-editor-actions"><button className="primary-button" type="submit"><Save size={16} /> {busy ? 'Saving...' : 'Save draft'}</button>{id !== 'new' && <><button className="secondary-button" type="button" disabled={!canPublish} onClick={() => setConfirm('publish')}><Upload size={16} /> Publish contest</button><button className="admin-icon-button admin-danger" aria-label="Delete contest draft" title="Delete contest draft" type="button" onClick={() => setConfirm('delete')}><Trash2 size={17} /></button></>}</div>}
      {confirm === 'publish' && <Confirmation busy={busy} onCancel={() => setConfirm('')} action={<button className="primary-button" type="submit" value="published"><Check size={16} /> Confirm publication</button>}>Publish this contest? Its schedule, problems, and points will be permanently locked. Cancellation is available only before the start.</Confirmation>}
    </fieldset></form>
    {canCancel && <button className="secondary-button admin-danger" disabled={busy} onClick={() => setConfirm('cancel')}><X size={16} /> Cancel contest</button>}
    {(confirm === 'delete' || confirm === 'cancel') && <Confirmation busy={busy} danger onCancel={() => setConfirm('')} action={<button type="button" disabled={busy} className="secondary-button admin-danger" onClick={() => changeStatus(confirm)}>{confirm === 'delete' ? <Trash2 size={16} /> : <X size={16} />}{confirm === 'delete' ? 'Delete draft' : 'Confirm cancellation'}</button>}>{confirm === 'delete' ? 'Delete this contest draft permanently?' : 'Cancel this contest? Students will no longer be able to join or submit.'}</Confirmation>}
  </div>
}
