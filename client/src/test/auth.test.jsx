import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

const student = {
  id: 'student-1',
  name: 'Test Student',
  email: 'student@famt.ac.in',
  department: 'it',
  year: '2nd',
  role: 'student',
  solvedCount: 4,
}

function reply(data, status = 200) {
  return { ok: status < 400, status, json: async () => data }
}

function mockApi(handlers = {}) {
  const requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options) => {
      const path = url.replace('/api', '')
      const body = options.body ? JSON.parse(options.body) : null
      requests.push({ path, body, headers: options.headers, credentials: options.credentials })
      const handler = handlers[path]
      if (handler) return handler(body, options)
      if (path === '/users/me') return sessionStorage.getItem('codefamt-token') ? reply({ user: student }) : reply({ message: 'Log in to continue' }, 401)
      if (path.startsWith('/users/me/activity?')) return reply({ year: Number(new URLSearchParams(path.split('?')[1]).get('year')), today: new Date().toISOString().slice(0, 10), days: [] })
      throw new Error(`Unexpected request: ${path}`)
    }),
  )
  return requests
}

function open(path) {
  window.history.replaceState({}, '', path)
  return render(<App />)
}

async function fillRegistration(options) {
  const user = userEvent.setup(options)
  await user.type(screen.getByLabelText('Full name'), 'Test Student')
  await user.selectOptions(screen.getByLabelText('Department'), 'it')
  await user.selectOptions(screen.getByLabelText('Year'), '2nd')
  await user.type(screen.getByLabelText('College email'), 'student@famt.ac.in')
  await user.type(
    screen.getByLabelText('Password', { exact: true }),
    'Testing123!',
  )
  return user
}

beforeEach(() => sessionStorage.clear())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Account flows', () => {
  it('redirects an unauthenticated visitor away from protected pages', async () => {
    mockApi()
    await act(async () => { open('/admin') })
    expect(
      await screen.findByRole('heading', { name: 'Welcome back' }),
    ).toBeVisible()
    expect(window.location.pathname).toBe('/login')
  })

  it('rejects a non-college email before calling the API', async () => {
    const requests = mockApi()
    await act(async () => { open('/login') })
    const user = userEvent.setup()
    await user.type(
      screen.getByLabelText('College email'),
      'student@example.com',
    )
    await user.type(
      screen.getByLabelText('Password', { exact: true }),
      'Testing123!',
    )
    await user.click(
      screen.getByRole('button', { name: 'Sign in', exact: true }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent('@famt.ac.in')
    expect(requests.filter(request => request.path === '/auth/login')).toHaveLength(0)
  })

  it('registers and verifies with all required details without persisting the password', async () => {
    const requests = mockApi({
      '/auth/register': () => reply({}),
      '/auth/verify-otp': () => reply({}),
    })
    await act(async () => { open('/register') })
    const user = await fillRegistration()
    await user.click(
      screen.getByRole('button', { name: 'Create account', exact: true }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Verify your email' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: /Resend code in/ }),
    ).toBeDisabled()
    expect(sessionStorage.length).toBe(0)
    await user.type(screen.getByLabelText('Verification code'), '012345')
    await user.click(
      screen.getByRole('button', { name: 'Verify email', exact: true }),
    )
    expect(
      await screen.findByRole('heading', { name: 'You’re all set' }),
    ).toBeVisible()
    expect(requests.find(request => request.path === '/auth/verify-otp').body).toEqual({
      name: 'Test Student',
      email: student.email,
      password: 'Testing123!',
      department: 'it',
      year: '2nd',
      otp: '012345',
    })
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('keeps the verification form usable after a wrong OTP and resends after cooldown', async () => {
    vi.useFakeTimers()
    const requests = mockApi({
      '/auth/register': () => reply({}),
      '/auth/verify-otp': () => reply({ message: 'Invalid OTP' }, 400),
      '/auth/resend-otp': () => reply({ message: 'A new code was sent' }),
    })
    await act(async () => { open('/register') })
    fireEvent.change(screen.getByLabelText('Full name'), {
      target: { value: student.name },
    })
    fireEvent.change(screen.getByLabelText('Department'), {
      target: { value: 'it' },
    })
    fireEvent.change(screen.getByLabelText('Year'), {
      target: { value: '2nd' },
    })
    fireEvent.change(screen.getByLabelText('College email'), {
      target: { value: student.email },
    })
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: 'Testing123!' },
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Create account', exact: true }),
      )
    })
    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '111111' },
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Verify email', exact: true }),
      )
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid OTP')
    for (let i = 0; i < 61; i++)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Resend code', exact: true }),
      )
    })
    expect(screen.getByRole('status')).toHaveTextContent('A new code was sent')
    expect(requests.at(-1).body).toEqual({ email: student.email })
  })

  it.each(['student', 'admin'])(
    'signs in a %s and uses the backend role for the destination',
    async (role) => {
      const requests = mockApi({
        '/auth/login': () =>
          reply({ token: 'test-token', user: { ...student, role } }),
        '/users/me': () => sessionStorage.getItem('codefamt-token') ? reply({ user: { ...student, role } }) : reply({ message: 'Log in to continue' }, 401),
        '/users/me/solved?limit=5&page=1': () => reply({ solvedProblems: [], total: 0 }),
        '/problems?visibility=public&limit=1&page=1': () => reply({ problems: [], total: 0 }),
        '/submissions?limit=1&page=1': () => reply({ submissions: [], total: 0 }),
        '/problems?page=1&limit=20': () => reply({ problems: [], total: 0 }),
      })
      await act(async () => { open('/login') })
      const user = userEvent.setup()
      await user.type(await screen.findByLabelText('College email'), student.email)
      await user.type(
        screen.getByLabelText('Password', { exact: true }),
        'Testing123!',
      )
      await user.click(
        screen.getByRole('button', { name: 'Sign in', exact: true }),
      )
      await waitFor(() => expect(
        screen.getByRole('heading', {
          name: role === 'admin' ? 'Administration' : 'Problems',
          exact: true,
        }),
      ).toBeVisible())
      expect(sessionStorage.getItem('codefamt-token')).toBe('cookie-session')
      await waitFor(() =>
        expect(
          requests.some(
            (request) => request.path === '/users/me' && request.credentials === 'include' && !request.headers.Authorization,
          ),
        ).toBe(true),
      )
      expect(window.location.pathname).toBe(
        role === 'admin' ? '/admin' : '/problems',
      )
    },
  )

  it('does not allow a student to open the admin page', async () => {
    sessionStorage.setItem('codefamt-token', 'student-token')
    mockApi()
    await act(async () => { open('/admin') })
    expect(
      await screen.findByRole('heading', { name: 'My profile', exact: true }),
    ).toBeVisible()
    expect(window.location.pathname).toBe('/profile')
    expect(
      screen.queryByRole('link', { name: 'Admin', exact: true }),
    ).not.toBeInTheDocument()
  })

  it('clears a rejected session on page reload', async () => {
    sessionStorage.setItem('codefamt-token', 'expired-token')
    mockApi({ '/users/me': () => reply({ message: 'Session expired' }, 401) })
    await act(async () => { open('/profile') })
    expect(
      await screen.findByRole('heading', { name: 'Welcome back' }),
    ).toBeVisible()
    expect(sessionStorage.getItem('codefamt-token')).toBeNull()
  })

  it('retains a session during a server outage and supports retry', async () => {
    sessionStorage.setItem('codefamt-token', 'test-token')
    let available = false
    mockApi({
      '/users/me': () =>
        available
          ? reply({ user: student })
          : reply({ message: 'Service unavailable' }, 503),
    })
    await act(async () => { open('/profile') })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Service unavailable',
    )
    expect(sessionStorage.getItem('codefamt-token')).toBe('test-token')
    available = true
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('heading', { name: 'My profile', exact: true }),
    ).toBeVisible()
  })

  it('updates a profile and logs out through the server', async () => {
    sessionStorage.setItem('codefamt-token', 'test-token')
    let profile = { ...student }
    const requests = mockApi({
      '/users/me': (body) => {
        if (body) profile = { ...profile, ...body }
        return reply({ user: profile })
      },
      '/auth/logout': () => reply({}),
    })
    await act(async () => { open('/profile') })
    await screen.findByRole('heading', { name: 'My profile', exact: true })
    const user = userEvent.setup()
    await user.click(screen.getByText('Edit personal information'))
    await user.selectOptions(screen.getByLabelText('Department'), 'aiml')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your profile has been updated.',
    )
    expect(
      requests.some((request) => request.body?.department === 'aiml'),
    ).toBe(true)
    await user.click(
      screen.getByRole('button', { name: 'Sign out on all devices' }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Welcome back' }),
    ).toBeVisible()
    expect(sessionStorage.length).toBe(0)
    expect(requests.at(-1).path).toBe('/auth/logout')
  })

  it('completes password recovery with the backend reset contract', async () => {
    const requests = mockApi({
      '/auth/forgot-password': () =>
        reply({ message: 'If this account exists, a code was sent' }),
      '/auth/reset-password': () =>
        reply({ message: 'Password changed. Log in again' }),
    })
    await act(async () => { open('/forgot-password') })
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('College email'), student.email)
    await user.click(screen.getByRole('button', { name: 'Send reset code' }))
    await user.type(await screen.findByLabelText('Verification code'), '123456')
    await user.type(
      screen.getByLabelText('New password', { exact: true }),
      'NewPassword123!',
    )
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(
      await screen.findByRole('heading', { name: 'Password updated' }),
    ).toBeVisible()
    expect(requests.at(-1).body).toEqual({
      email: student.email,
      otp: '123456',
      newPassword: 'NewPassword123!',
    })
  })

  it('shows an actionable network error and allows retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    )
    await act(async () => { open('/login') })
    fireEvent.change(screen.getByLabelText('College email'), {
      target: { value: student.email },
    })
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: 'Testing123!' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Sign in', exact: true }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the server',
    )
    expect(
      screen.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeEnabled()
  })
})


it('restores a persistent cookie session after all tab storage is cleared', async () => {
  sessionStorage.clear()
  const requests = mockApi({ '/users/me': () => reply({ user: student }) })
  await act(async () => { open('/profile') })
  expect(await screen.findByRole('heading', { name: 'My profile', exact: true })).toBeVisible()
  expect(requests.find(item => item.path === '/users/me')).toEqual(expect.objectContaining({ credentials: 'include', headers: {} }))
  expect(sessionStorage.getItem('codefamt-token')).toBeNull()
})
