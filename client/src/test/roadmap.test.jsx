import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RoadmapPage from '../pages/RoadmapPage'
import { api } from '../api'

const state = vi.hoisted(() => ({ role: 'admin', roadmap: null, reload: vi.fn() }))
vi.mock('../api', () => ({ api: vi.fn() }))
vi.mock('../context/auth', () => ({ useAuth: () => ({ user: { role: state.role }, token: 'test-token' }) }))
vi.mock('../hooks/useApi', () => ({ useApi: () => ({ data: { roadmap: state.roadmap }, loading: false, error: '', reload: state.reload }) }))

beforeEach(() => {
  vi.clearAllMocks()
  state.role = 'admin'
  state.roadmap = { title: 'Course roadmap', description: 'Start here', sheetUrl: 'https://example.com/sheet', steps: [
    { id: 'arrays', title: 'Arrays', description: 'Indexing', resourceUrl: 'https://example.com/arrays' },
    { id: 'search', title: 'Searching', description: 'Binary search', resourceUrl: '' },
  ] }
})

it('students can read the sheet and ordered topics without editing controls', () => {
  state.role = 'student'
  render(<RoadmapPage />)
  expect(screen.queryByRole('button', { name: 'Edit roadmap' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Practice sheet/ })).toHaveAttribute('href', state.roadmap.sheetUrl)
  expect(screen.getAllByRole('listitem').map(item => within(item).getByRole('heading').textContent)).toEqual(['Arrays', 'Searching'])
})

it('admins can reorder topics and save exactly the editable roadmap fields', async () => {
  api.mockResolvedValue({})
  const user = userEvent.setup()
  render(<RoadmapPage />)
  await user.click(screen.getByRole('button', { name: 'Edit roadmap' }))
  await user.click(screen.getByRole('button', { name: 'Move step 2 up' }))
  fireEvent.change(screen.getByLabelText('Practice sheet link'), { target: { value: 'https://example.com/new-sheet' } })
  await user.click(screen.getByRole('button', { name: 'Save roadmap' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/roadmap', expect.objectContaining({ method: 'PUT', body: {
    ...state.roadmap, sheetUrl: 'https://example.com/new-sheet', steps: [...state.roadmap.steps].reverse(),
  } })))
  expect(state.reload).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('a failed save keeps the edits open for correction and retry', async () => {
  api.mockRejectedValue(new Error('Could not save roadmap'))
  const user = userEvent.setup()
  render(<RoadmapPage />)
  await user.click(screen.getByRole('button', { name: 'Edit roadmap' }))
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated roadmap' } })
  await user.click(screen.getByRole('button', { name: 'Save roadmap' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save roadmap')
  expect(screen.getByLabelText('Title')).toHaveValue('Updated roadmap')
  expect(screen.getByRole('button', { name: 'Save roadmap' })).toBeEnabled()
  expect(state.reload).not.toHaveBeenCalled()
})

it('saves personal completion and leaves progress unchanged on failure', async () => {
  state.role = 'student'
  api.mockResolvedValueOnce({ stepId: 'arrays', completed: true }).mockRejectedValueOnce(new Error('Save failed'))
  const user = userEvent.setup()
  render(<RoadmapPage />)
  await user.click(screen.getByRole('checkbox', { name: 'Mark Arrays complete' }))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Mark Arrays complete' })).toBeChecked())
  expect(screen.getByText('1 of 2 topics completed · 50%')).toBeInTheDocument()
  expect(api).toHaveBeenCalledWith('/roadmap/progress', expect.objectContaining({ body: { stepId: 'arrays', completed: true } }))
  await user.click(screen.getByRole('checkbox', { name: 'Mark Searching complete' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Save failed')
  expect(screen.getByRole('checkbox', { name: 'Mark Searching complete' })).not.toBeChecked()
})
