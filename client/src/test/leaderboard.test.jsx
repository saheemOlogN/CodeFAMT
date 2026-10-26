import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LeaderboardPage from '../pages/LeaderboardPage'
import { api } from '../api'

const auth = vi.hoisted(() => ({ user: { id: 'student-2' }, token: 'token', clearSession: vi.fn() }))
vi.mock('../context/auth', () => ({ useAuth: () => auth }))
vi.mock('../api', () => ({ api: vi.fn() }))

const problems = [
  { _id: 'problem-1', title: 'Pair Sum', visibility: 'public' },
  { _id: 'problem-2', title: 'Shortest Path', visibility: 'public' },
]
const rows = [
  { rank: 1, user: { id: 'student-1', name: 'Aisha Khan', department: 'it', year: '2nd' }, solvedCount: 12, easyCount: 6, mediumCount: 4, hardCount: 2, lastSolvedAt: '2026-10-23T09:00:00.000Z' },
  { rank: 1, user: { id: 'student-2', name: 'Rohan Shah', department: 'aiml', year: '3rd' }, solvedCount: 12, easyCount: 7, mediumCount: 3, hardCount: 2, lastSolvedAt: '2026-10-23T10:00:00.000Z' },
  { rank: 3, user: { id: 'student-3', name: 'Priya Patil', department: 'mechanical', year: '1st' }, solvedCount: 0, easyCount: 0, mediumCount: 0, hardCount: 0, lastSolvedAt: null },
]

function respond({ total = rows.length, leaderboard = rows, library = problems } = {}) {
  api.mockImplementation(async path => {
    if (path.startsWith('/problems?')) return { problems: library, total: library.length }
    if (path.startsWith('/users/leaderboard?')) return { leaderboard, total, page: Number(new URLSearchParams(path.split('?')[1]).get('page')), limit: 20 }
    throw new Error(`Unexpected request: ${path}`)
  })
}

function latestQuery() {
  const path = api.mock.calls.filter(([path]) => path.startsWith('/users/leaderboard?')).at(-1)?.[0]
  return Object.fromEntries(new URLSearchParams(path?.split('?')[1]))
}

beforeEach(() => {
  vi.clearAllMocks()
  respond()
})

describe('Leaderboard', () => {
  it('displays shared server ranks, difficulty totals, departments and the current student', async () => {
    render(<LeaderboardPage />)
    const table = await screen.findByRole('table', { name: 'Student rankings by total problems solved' })
    const resultRows = within(table).getAllByRole('row').slice(1)
    expect(resultRows.map(row => within(row).getAllByRole('cell')[0].textContent)).toEqual(['1', '1', '3'])
    expect(within(resultRows[0]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1', 'Aisha Khan', 'Information Technology', '2nd year', '12', '6', '4', '2'])
    expect(within(resultRows[1]).getByText('You')).toBeVisible()
    expect(resultRows[1]).toHaveClass('leaderboard-current-user')
    expect(within(resultRows[2]).getByText('Priya Patil')).toBeVisible()
    expect(screen.getByText('Equal totals share a rank.', { exact: false })).toBeVisible()
    expect(api).toHaveBeenCalledWith('/problems?visibility=public&limit=100&page=1', expect.objectContaining({ token: 'token' }))
  })

  it('combines filters, preserves them while paging and returns to page one after each filter change', async () => {
    respond({ total: 45 })
    const user = userEvent.setup()
    render(<LeaderboardPage />)
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(latestQuery()).toEqual({ page: '2', limit: '20' }))
    await user.selectOptions(screen.getByLabelText('Department'), 'aiml')
    await waitFor(() => expect(latestQuery()).toEqual({ page: '1', limit: '20', department: 'aiml' }))
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await user.selectOptions(screen.getByLabelText('Year'), '3rd')
    await waitFor(() => expect(latestQuery()).toEqual({ page: '1', limit: '20', department: 'aiml', year: '3rd' }))
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await user.selectOptions(screen.getByLabelText('Problem'), 'problem-2')
    await waitFor(() => expect(latestQuery()).toEqual({ page: '1', limit: '20', department: 'aiml', year: '3rd', problemId: 'problem-2' }))
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(latestQuery()).toEqual({ page: '2', limit: '20', department: 'aiml', year: '3rd', problemId: 'problem-2' }))
    await user.click(screen.getByRole('button', { name: 'Reset filters' }))
    await waitFor(() => expect(latestQuery()).toEqual({ page: '1', limit: '20' }))
    expect(screen.getByLabelText('Department')).toHaveValue('')
    expect(screen.getByLabelText('Year')).toHaveValue('')
    expect(screen.getByLabelText('Problem')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeDisabled()
  })

  it('limits the problem picker to public problems and shows first acceptance dates for an individual problem', async () => {
    respond({ leaderboard: [rows[0]], total: 1, library: [...problems, { _id: 'draft', title: 'Hidden draft', visibility: 'private' }, { _id: 'contest', title: 'Contest challenge', visibility: 'contest' }] })
    const user = userEvent.setup()
    render(<LeaderboardPage />)
    await screen.findByRole('option', { name: 'Pair Sum' })
    expect(screen.queryByRole('option', { name: /Hidden draft|Contest challenge/ })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Problem'), 'problem-1')
    const table = await screen.findByRole('table', { name: 'Student rankings by earliest accepted solution' })
    expect(within(table).getByRole('columnheader', { name: 'First solved' })).toBeVisible()
    expect(within(table).queryByRole('columnheader', { name: 'Solved' })).not.toBeInTheDocument()
    expect(table.querySelector('time')).toHaveAttribute('datetime', rows[0].lastSolvedAt)
    expect(table.querySelector('time')).not.toHaveTextContent('Invalid Date')
    expect(screen.getByText('Ranked by the earliest accepted solution for this problem.')).toBeVisible()
  })

  it('shows request failures, supports retry and explains an empty filtered ranking', async () => {
    let failed = true
    api.mockImplementation(async path => {
      if (path.startsWith('/problems?')) return { problems, total: problems.length }
      if (failed) throw new Error('Rankings are temporarily unavailable')
      return { leaderboard: [], total: 0, page: 1, limit: 20 }
    })
    const user = userEvent.setup()
    render(<LeaderboardPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Rankings are temporarily unavailable')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    failed = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No students yet')).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Problem'), 'problem-1')
    expect(await screen.findByText('No matching students')).toBeVisible()
    expect(screen.getByText('No accepted solutions match these filters.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  })

  it('keeps overall rankings usable when the problem list fails and retries the problem list separately', async () => {
    let failed = true
    api.mockImplementation(async path => {
      if (path.startsWith('/problems?')) {
        if (failed) throw new Error('Unable to load problems')
        return { problems, total: problems.length }
      }
      return { leaderboard: rows, total: rows.length, page: 1, limit: 20 }
    })
    render(<LeaderboardPage />)
    expect(await screen.findByRole('table')).toBeVisible()
    expect(await screen.findByRole('alert')).toHaveTextContent('Problem filters are unavailable')
    expect(screen.getByLabelText('Problem')).toBeDisabled()
    expect(screen.getByLabelText('Department')).toBeEnabled()
    failed = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry problems' }))
    await waitFor(() => expect(screen.getByLabelText('Problem')).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
