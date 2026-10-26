import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api'
import AdminPage from '../pages/AdminPage'

vi.mock('../api', () => ({ api: vi.fn() }))
vi.mock('../context/auth', () => ({ useAuth: () => ({ token: 'admin-token' }) }))

const draft = {
  _id: 'problem-1', title: 'Pair Sum', slug: 'pair-sum', statement: 'Add two numbers.',
  difficulty: 'easy', tags: ['math'], inputFormat: 'Two integers.', outputFormat: 'Their sum.',
  dsa: [{ language: 'cpp', starter: 'int add(int a,int b){return 0;}', prefix: '#include <bits/stdc++.h>', suffix: 'int main(){}' }], constraints: '1 <= a, b <= 100', examples: [], timeLimitMs: 1000, memoryLimitMb: 256, visibility: 'draft',
}

beforeEach(() => vi.clearAllMocks())

describe('Admin editor dialogs', () => {
  function mockLists() {
    api.mockImplementation(async (path) => {
      if (path.startsWith('/problems?')) return { problems: [draft], total: 1 }
      if (path.startsWith('/contests?')) return { contests: [], total: 0 }
      throw new Error(`Unexpected request: ${path}`)
    })
  }

  it('opens contest creation in a dialog and restores focus on dismiss', async () => {
    mockLists()
    const user = userEvent.setup()
    render(<AdminPage />)
    const opener = screen.getByRole('button', { name: 'New contest' })
    await user.click(opener)
    expect(await screen.findByRole('dialog', { name: 'New contest' })).toHaveAttribute('aria-modal', 'true')
    expect(document.body.style.overflow).toBe('hidden')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('opens and resets a contest dialog, and dismisses only clicks outside the panel', async () => {
    mockLists()
    const user = userEvent.setup()
    render(<AdminPage />)
    await user.click(screen.getByRole('tab', { name: 'Contests' }))
    const opener = screen.getByRole('button', { name: 'New contest' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'New contest' })
    await user.type(await screen.findByLabelText('Title'), 'Unsaved contest')
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 900, top: 100, bottom: 700 })
    fireEvent.pointerDown(dialog, { clientX: 110, clientY: 110 })
    fireEvent.click(dialog, { clientX: 110, clientY: 110 })
    expect(dialog).toBeVisible()
    fireEvent.pointerDown(dialog, { clientX: 10, clientY: 10 })
    fireEvent.click(dialog, { clientX: 10, clientY: 10 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    await user.click(opener)
    expect(await screen.findByLabelText('Title')).toHaveValue('')
    expect(screen.getByLabelText('Starts (local time)')).toHaveValue('')
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('creates a problem inside a contest and retains contest details when returning', async () => {
    let saved
    api.mockImplementation(async (path, options = {}) => {
      if (path.startsWith('/contests?')) return { contests: [], total: 0 }
      if (path.startsWith('/problems?')) return { problems: [], total: 0 }
      if (path === '/problems' && options.method === 'POST') { saved = { ...options.body, _id: 'problem-1' }; return { problem: saved } }
      if (path === '/problems/problem-1') return { problem: saved }
      if (path.includes('/tests?')) return { testCases: [], total: 0 }
      throw new Error(path)
    })
    const user = userEvent.setup()
    render(<AdminPage />)
    await user.click(screen.getByRole('button', { name: 'New contest' }))
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Campus Sprint' } })
    await user.click(screen.getByRole('button', { name: 'Create problem' }))
    const fields = { Title: draft.title, Slug: draft.slug, Statement: draft.statement, 'Function arguments / test input': draft.inputFormat, 'Return value / expected output': draft.outputFormat, Constraints: draft.constraints }
    for (const [label, value] of Object.entries(fields)) fireEvent.change(screen.getByLabelText(label), { target: { value } })
    await user.click(screen.getByRole('button', { name: 'Add C++', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add test' })).toBeEnabled())
    expect(saved.dsa[0].language).toBe('cpp')
    await user.click(screen.getByRole('button', { name: 'Back to contest' }))
    expect(screen.getByLabelText('Title')).toHaveValue('Campus Sprint')
    expect(screen.getByText('Pair Sum')).toBeVisible()
    expect(screen.getByLabelText('Points')).toHaveValue(100)
  })

})

describe('Admin publication workflows', () => {
  it('requires a saved hidden test and explicit confirmation before publishing a problem', async () => {
    let problem = { ...draft }
    api.mockImplementation(async (path, options = {}) => {
      if (path.startsWith('/problems?')) return { problems: [problem], total: 1 }
      if (path === '/problems/problem-1/tests?limit=100') return { testCases: [], total: 0 }
      if (path === '/problems/problem-1/tests' && options.method === 'POST') return { testCase: { _id: 'test-1', ...options.body } }
      if (path === '/problems/problem-1' && options.method === 'PATCH') { problem = { ...problem, ...options.body }; return { problem } }
      if (path === '/problems/problem-1') return { problem }
      throw new Error(`Unexpected request: ${path}`)
    })
    const user = userEvent.setup()
    render(<AdminPage />)
    await user.click(screen.getByRole('tab', { name: 'Problems' }))
    await user.click(await screen.findByRole('button', { name: 'Pair Sum', exact: true }))
    expect(await screen.findByRole('button', { name: 'Publish to library' })).toBeDisabled()
    await user.click(await screen.findByRole('button', { name: 'Add test' }))
    fireEvent.change(screen.getByLabelText('Input', { exact: true }), { target: { value: '1 2\n' } })
    fireEvent.change(screen.getByLabelText('Expected output', { exact: true }), { target: { value: '3\n' } })
    await user.click(screen.getByRole('button', { name: 'Save test' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish to library' })).toBeEnabled())
    expect(api).toHaveBeenCalledWith('/problems/problem-1/tests', expect.objectContaining({ method: 'POST', body: { input: '1 2\n', expectedOutput: '3\n' } }))
    await user.click(screen.getByRole('button', { name: 'Publish to library' }))
    expect(api.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Confirm publication' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/problems/problem-1', expect.objectContaining({ method: 'PATCH', body: expect.objectContaining({ visibility: 'public', tags: ['math'], timeLimitMs: 1000 }) })))
    expect(await screen.findByText('Published problem and test cases are locked.')).toBeVisible()
    expect(screen.getByLabelText('Title')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Add test' })).not.toBeInTheDocument()
  })

  it('keeps a published problem and its hidden tests immutable', async () => {
    const problem = { ...draft, visibility: 'contest' }
    api.mockImplementation(async (path) => {
      if (path.startsWith('/problems?')) return { problems: [problem], total: 1 }
      if (path.includes('/tests')) return { testCases: [{ _id: 't1', input: '2 3', expectedOutput: '5' }], total: 1 }
      return { problem }
    })
    render(<AdminPage />)
    await userEvent.click(screen.getByRole('tab', { name: 'Problems' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Pair Sum', exact: true }))
    expect(await screen.findByText('Published problem and test cases are locked.')).toBeVisible()
    expect(screen.getByLabelText('Statement')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Delete problem draft' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add test' })).not.toBeInTheDocument()
    expect(await screen.findByText('2 3')).toBeVisible()
  })

  it('offers only unused contest problems and sends structured contest entries', async () => {
    const problems = [
      { ...draft, _id: 'eligible', title: 'Eligible challenge', visibility: 'contest' },
      { ...draft, _id: 'used', title: 'Used challenge', visibility: 'contest' },
      { ...draft, _id: 'public', title: 'Public challenge', visibility: 'public' },
      { ...draft, _id: 'draft', title: 'Draft challenge' },
    ]
    const requests = []
    api.mockImplementation(async (path, options = {}) => {
      requests.push({ path, ...options })
      if (path.startsWith('/problems?')) return { problems, total: problems.length }
      if (path.startsWith('/contests?')) return { contests: [{ _id: 'existing', title: 'Existing', status: 'published', startTime: '2030-10-23T10:00:00Z' }], total: 1 }
      if (path === '/contests/existing') return { contest: { problems: [{ problem: { _id: 'used' }, points: 100 }] } }
      if (path === '/contests' && options.method === 'POST') throw new Error('Draft save reached the API')
      throw new Error(`Unexpected request: ${path}`)
    })
    const user = userEvent.setup()
    render(<AdminPage />)
    await user.click(screen.getByRole('tab', { name: 'Contests' }))
    await user.click(screen.getByRole('button', { name: 'New contest' }))
    const picker = await screen.findByLabelText('Add a contest problem')
    expect(screen.getByRole('option', { name: 'Eligible challenge (easy)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Used challenge|Public challenge/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Draft challenge (easy)' })).toBeInTheDocument()
    await user.selectOptions(picker, 'eligible')
    await user.click(screen.getByRole('button', { name: 'Add problem', exact: true }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Campus Sprint' } })
    fireEvent.change(screen.getByLabelText('Starts (local time)'), { target: { value: '2030-10-24T10:00' } })
    fireEvent.change(screen.getByLabelText('Ends (local time)'), { target: { value: '2030-10-24T12:00' } })
    fireEvent.change(screen.getByLabelText('Points'), { target: { value: '250' } })
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(requests).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/contests', method: 'POST', body: { title: 'Campus Sprint', description: '', startTime: new Date('2030-10-24T10:00').toISOString(), endTime: new Date('2030-10-24T12:00').toISOString(), status: 'draft', problems: [{ problem: 'eligible', points: 250 }] } })])))
    expect(await screen.findByRole('alert')).toHaveTextContent('Draft save reached the API')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled()
  })
})

it('previews a JSON upload and appends the batch only after confirmation', async () => {
  let imported = false
  api.mockImplementation(async (path, options = {}) => {
    if (path.startsWith('/contests?')) return { contests: [], total: 0 }
    if (path.startsWith('/problems?')) return { problems: [draft], total: 1 }
    if (path === '/problems/problem-1') return { problem: draft }
    if (path.endsWith('/tests?limit=100')) return { testCases: imported ? [{ _id: 't', input: '2 3', expectedOutput: '5' }] : [], total: imported ? 1 : 0 }
    if (path.endsWith('/tests/import')) { imported = true; return { imported: 1, total: 1 } }
    throw new Error(path)
  })
  const user = userEvent.setup()
  render(<AdminPage />)
  await user.click(screen.getByRole('tab', { name: 'Problems' }))
  await user.click(await screen.findByRole('button', { name: 'Pair Sum', exact: true }))
  const upload = await screen.findByLabelText('Import test cases (.json)')
  await waitFor(() => expect(upload).toBeEnabled())
  const content = JSON.stringify({ testCases: [{ input: '2 3', expectedOutput: '5' }] })
  const file = new File([content], 'tests.json', { type: 'application/json' })
  file.text = async () => content
  await user.upload(upload, file)
  expect(await screen.findByText(/1 tests ready to import/)).toBeVisible()
  expect(imported).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Import 1 tests' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/problems/problem-1/tests/import', expect.objectContaining({ method: 'POST', body: JSON.parse(content) })))
  expect(await screen.findByText('1 tests imported.')).toBeVisible()
})
