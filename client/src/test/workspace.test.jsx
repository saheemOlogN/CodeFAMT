import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProblemPage from '../pages/ProblemPage'
import { SubmissionDetailPage } from '../pages/SubmissionsPage'
import { api } from '../api'

const fixtures = vi.hoisted(() => ({ data: {}, user: { id: 'student-a', role: 'student' }, refreshUser: vi.fn() }))
vi.mock('../api', () => ({ api: vi.fn() }))
vi.mock('../context/auth', () => ({ useAuth: () => ({ user: fixtures.user, token: 'token', refreshUser: fixtures.refreshUser }) }))
vi.mock('../context/RealtimeProvider', () => ({ useRealtime: () => null }))
vi.mock('../hooks/useApi', () => ({ useApi: path => ({ data: fixtures.data[path], loading: false, error: '', reload: vi.fn() }) }))
vi.mock('../components/CodeEditor', () => ({ default: ({ value, onChange, readOnly }) => <textarea aria-label={readOnly ? 'Submitted source code' : 'Code editor'} value={value} onChange={event => onChange?.(event.target.value)} readOnly={readOnly} /> }))

const problemId = '507f1f77bcf86cd799439011'
const contestId = '507f1f77bcf86cd799439012'
const problem = { _id: problemId, title: 'Add two numbers', difficulty: 'easy', statement: 'Print the sum.', inputFormat: 'Two integers.', outputFormat: 'Their sum.', constraints: '0 <= a, b <= 100', timeLimitMs: 1000, memoryLimitMb: 128, examples: [{ input: '2 3', output: '5' }], tags: ['math'], dsa: [{ language: 'cpp', starter: 'int add(int a, int b) { return 0; }' }, { language: 'python', starter: 'def add(a, b):\n    return 0' }] }

function open(path) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/problems/:problemId" element={<ProblemPage />} /><Route path="/contests/:contestId/problems/:problemId" element={<ProblemPage />} /><Route path="/submissions/:submissionId" element={<SubmissionDetailPage />} /></Routes></MemoryRouter>)
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  fixtures.user = { id: 'student-a', role: 'student' }
  fixtures.data = { [`/problems/${problemId}`]: { problem } }
})

describe('Coding workspace', () => {
  it('runs saved examples and displays compared results', async () => {
    vi.mocked(api).mockImplementation(async path => path === '/submissions/run'
      ? { run: { _id: 'run-1', status: 'queued', language: 'cpp' } }
      : { run: { _id: 'run-1', status: 'completed', result: { cases: [{ input: 'a = 2, b = 3', stdout: '5', expectedOutput: '5', status: 'accepted' }], passedTests: 1, totalTests: 1 } } })
    open(`/problems/${problemId}`)
    fireEvent.change(screen.getByLabelText('Code editor'), { target: { value: 'int main() {}' } })
    fireEvent.click(screen.getByRole('button', { name: 'View testcase' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    expect(await screen.findByText('All examples passed')).toBeVisible()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('5')
    expect(api).toHaveBeenCalledWith('/submissions/run', expect.objectContaining({ method: 'POST', body: { mode: 'dsa', problemId, language: 'cpp', code: 'int main() {}', runExamples: true } }))
    expect(api).toHaveBeenCalledWith('/submissions/runs/run-1', expect.objectContaining({ token: 'token' }))
  })

  it('submits only the practice contract and refreshes profile after acceptance', async () => {
    vi.mocked(api).mockImplementation(async path => path === '/submissions'
      ? { submission: { _id: 'submission-1', status: 'queued', passedTests: 0, totalTests: 3 } }
      : { submission: { _id: 'submission-1', status: 'accepted', passedTests: 3, totalTests: 3, executionTimeMs: 10, memoryUsedMb: 1 } })
    open(`/problems/${problemId}`)
    fireEvent.change(screen.getByLabelText('Code editor'), { target: { value: 'solution' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true }))
    expect(await screen.findByText('Accepted')).toBeVisible()
    expect(api).toHaveBeenCalledWith('/submissions', expect.objectContaining({ body: { mode: 'dsa', problemId, language: 'cpp', code: 'solution' } }))
    await waitFor(() => expect(fixtures.refreshUser).toHaveBeenCalledWith(true))
  })

  it('keeps language drafts separate and scopes them to the signed-in student', () => {
    localStorage.setItem(`codefamt-draft:other-student:practice:${problemId}:cpp`, 'private code')
    open(`/problems/${problemId}`)
    expect(screen.getByLabelText('Code editor')).not.toHaveValue('private code')
    fireEvent.change(screen.getByLabelText('Code editor'), { target: { value: 'my C++ solution' } })
    fireEvent.change(screen.getByLabelText('Programming language'), { target: { value: 'python' } })
    fireEvent.change(screen.getByLabelText('Code editor'), { target: { value: 'print(42)' } })
    fireEvent.change(screen.getByLabelText('Programming language'), { target: { value: 'cpp' } })
    expect(screen.getByLabelText('Code editor')).toHaveValue('my C++ solution')
    expect(localStorage.getItem(`codefamt-draft:student-a:practice:${problemId}:dsa:python`)).toBe('print(42)')
  })

  it('uses server time to close contest submissions while preserving custom runs', () => {
    fixtures.data[`/contests/${contestId}/problems/${problemId}`] = { problem, points: 100, startTime: '2020-01-01T00:00:00Z', endTime: '2020-01-01T01:00:00Z', serverNow: '2020-01-01T01:01:00Z' }
    open(`/contests/${contestId}/problems/${problemId}`)
    expect(screen.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
    expect(screen.getByText('Contest ended')).toBeVisible()
  })

  it('shows provider failures without claiming a verdict', async () => {
    vi.mocked(api).mockRejectedValue(new Error('Code execution is not configured yet'))
    open(`/problems/${problemId}`)
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Code execution is not configured yet')
    expect(screen.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
  })
})

describe('Submission detail', () => {
  it('retries internal errors with an empty payload and preserves the submitted source', async () => {
    const submission = { _id: 'submission-1', problem: problemId, contest: null, code: 'saved source', language: 'python', status: 'internal_error', passedTests: 0, totalTests: 2, createdAt: '2026-10-22T12:00:00Z' }
    fixtures.data['/submissions/submission-1'] = { submission }
    vi.mocked(api).mockImplementation(async path => path.endsWith('/retry')
      ? { submission: { ...submission, code: undefined, status: 'queued' } }
      : { submission: { ...submission, status: 'accepted', passedTests: 2 } })
    open('/submissions/submission-1')
    fireEvent.click(await screen.findByRole('button', { name: 'Retry judging' }))
    expect(await screen.findByText('Accepted')).toBeVisible()
    expect(api).toHaveBeenCalledWith('/submissions/submission-1/retry', expect.objectContaining({ method: 'POST', body: {} }))
    expect(screen.getByLabelText('Submitted source code')).toHaveValue('saved source')
  })
})


describe('Function-only solutions', () => {
  it('loads the function template, hides CP controls, and never restores a legacy full-program draft', () => {
    localStorage.setItem(`codefamt-draft:student-a:practice:${problemId}:cpp`, 'old full program')
    open(`/problems/${problemId}`)
    expect(screen.getByLabelText('Code editor')).toHaveValue(problem.dsa[0].starter)
    expect(screen.queryByRole('button', { name: 'CP', exact: true })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Code editor'), { target: { value: 'my function' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset', exact: true }))
    expect(screen.getByLabelText('Code editor')).toHaveValue(problem.dsa[0].starter)
  })
  it('blocks running and submitting legacy problems until drivers are configured', () => {
    fixtures.data[`/problems/${problemId}`] = { problem: { ...problem, dsa: [] } }
    open(`/problems/${problemId}`)
    expect(screen.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled()
  })
})
