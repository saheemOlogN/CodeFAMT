import { useEffect, useState } from 'react'
import { ExternalLink, Plus, ArrowUp, ArrowDown, Trash2 } from 'lucide-react'
import { useAuth } from '../context/auth'
import { useApi } from '../hooks/useApi'
import { api } from '../api'
import Dialog from '../components/Dialog'
import { LoadState, EmptyState } from '../components/PlatformUI'
import './RoadmapPage.css'

export default function RoadmapPage() {
  const { user, token } = useAuth()
  const { data, loading, error, reload } = useApi('/roadmap')
  const [completed, setCompleted] = useState([])
  const [progressBusy, setProgressBusy] = useState(false)
  const [progressError, setProgressError] = useState('')
  useEffect(() => { setCompleted(data?.completed || []) }, [data?.completed])
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  useEffect(() => { document.title = 'Roadmap | CodeFAMT' }, [])
  const roadmap = data?.roadmap
  async function toggle(stepId, checked) {
    setProgressBusy(true); setProgressError('')
    try {
      await api('/roadmap/progress', { token, method: 'PATCH', body: { stepId, completed: checked } })
      setCompleted(current => checked ? [...new Set([...current, stepId])] : current.filter(id => id !== stepId))
    } catch (failure) { setProgressError(failure.message) }
    finally { setProgressBusy(false) }
  }
  const done = roadmap?.steps.filter(step => completed.includes(step.id)).length || 0
  const percent = roadmap?.steps.length ? Math.round(done / roadmap.steps.length * 100) : 0
  function updateStep(index, field, value) { setDraft(current => ({ ...current, steps: current.steps.map((step, i) => i === index ? { ...step, [field]: value } : step) })) }
  function move(index, direction) {
    setDraft(current => { const steps = [...current.steps]; [steps[index], steps[index + direction]] = [steps[index + direction], steps[index]]; return { ...current, steps } })
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setSaveError('')
    try { await api('/roadmap', { token, method: 'PUT', body: draft }); setDraft(null); reload() }
    catch (failure) { setSaveError(failure.message) }
    finally { setBusy(false) }
  }
  return <section className="platform-page roadmap-page">
    <div className="platform-heading"><div><h1>{roadmap?.title || 'Learning roadmap'}</h1>{roadmap?.description && <p>{roadmap.description}</p>}</div>
      {user.role === 'admin' && roadmap && <button className="secondary-button" onClick={() => { setSaveError(''); setDraft({ title: roadmap.title, description: roadmap.description, sheetUrl: roadmap.sheetUrl, steps: roadmap.steps.map(({ id, title, description, resourceUrl }) => ({ ...(id ? { id } : {}), title, description, resourceUrl })) }) }}>Edit roadmap</button>}
    </div>
    <LoadState loading={loading} error={error} retry={reload} />
    {roadmap && !loading && !error && <>
      {!!roadmap.steps.length && <div className="roadmap-progress"><div><strong>Your progress</strong><span>{done} of {roadmap.steps.length} topics completed · {percent}%</span></div><progress aria-label="Roadmap completion" value={done} max={roadmap.steps.length} /><p>Check a topic when you have studied it and practised its exercises. Progress is saved to your account.</p></div>}
      {progressError && <p className="notice notice-error" role="alert">{progressError}</p>}
      {roadmap.sheetUrl && <a className="roadmap-sheet" href={roadmap.sheetUrl} target="_blank" rel="noopener noreferrer"><div><strong>Practice sheet</strong><span>Open the complete collection of learning resources and exercises</span></div><ExternalLink size={20} /></a>}
      {roadmap.steps.length ? <ol className="roadmap-steps">{roadmap.steps.map((step, index) => <li key={step.id || index} className={completed.includes(step.id) ? 'roadmap-complete' : ''}><input className="roadmap-checkbox" type="checkbox" aria-label={`Mark ${step.title} complete`} checked={completed.includes(step.id)} disabled={progressBusy || !step.id} onChange={event => toggle(step.id, event.target.checked)} /><span className="roadmap-number">{String(index + 1).padStart(2, '0')}</span><div><h2>{step.title}</h2>{step.description && <p>{step.description}</p>}{step.resourceUrl && <a className="inline-link" href={step.resourceUrl} target="_blank" rel="noopener noreferrer">Open resource <ExternalLink size={14} /></a>}</div></li>)}</ol> : <EmptyState title="Roadmap coming soon">Your instructors will add topic-wise steps and a practice sheet here.</EmptyState>}
    </>}
    {draft && <Dialog title="Edit roadmap" busy={busy} onClose={() => setDraft(null)}><form onSubmit={save} className="roadmap-editor"><fieldset disabled={busy}>
      {saveError && <p className="notice notice-error" role="alert">{saveError}</p>}
      <label>Title<input required maxLength={120} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>Description<textarea maxLength={2000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      <label>Practice sheet link<input type="url" pattern="https://.*" placeholder="https://docs.google.com/spreadsheets/..." value={draft.sheetUrl} onChange={event => setDraft({ ...draft, sheetUrl: event.target.value })} /></label>
      <p className="small-note">Use shareable HTTPS links. Students need permission to view the sheet and resources.</p>
      {draft.steps.map((step, index) => <section className="roadmap-edit-step" key={index}><div className="roadmap-step-actions"><strong>Step {index + 1}</strong><button type="button" className="icon-button" aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button><button type="button" className="icon-button" aria-label={`Move step ${index + 1} down`} disabled={index === draft.steps.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button><button type="button" className="icon-button" aria-label={`Remove step ${index + 1}`} onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })}><Trash2 size={16} /></button></div>
        <label>Topic<input required maxLength={120} value={step.title} onChange={event => updateStep(index, 'title', event.target.value)} /></label>
        <label>What to learn<textarea maxLength={2000} value={step.description} onChange={event => updateStep(index, 'description', event.target.value)} /></label>
        <label>Resource link<input type="url" pattern="https://.*" value={step.resourceUrl} onChange={event => updateStep(index, 'resourceUrl', event.target.value)} /></label>
      </section>)}
      <div className="heading-actions"><button className="secondary-button" type="button" disabled={draft.steps.length >= 100} onClick={() => setDraft({ ...draft, steps: [...draft.steps, { id: crypto.randomUUID(), title: '', description: '', resourceUrl: '' }] })}><Plus size={16} /> Add topic</button><button className="primary-button" type="submit">{busy ? 'Saving…' : 'Save roadmap'}</button></div>
    </fieldset></form></Dialog>}
  </section>
}
