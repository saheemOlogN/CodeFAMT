import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../api'

afterEach(() => vi.unstubAllGlobals())

it.each([500, 502, 503, 504])('explains an empty proxy failure (%s) without retrying the sign-in POST', async status => {
  const fetch = vi.fn().mockResolvedValue({ ok: false, status, json: async () => { throw new SyntaxError('Not JSON') } })
  vi.stubGlobal('fetch', fetch)
  await expect(api('/auth/login', { method: 'POST', body: { email: 'test@famt.ac.in', password: 'test-password' } })).rejects.toMatchObject({
    status, message: 'The server is restarting or unavailable. Wait a moment and try again.',
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('preserves the server login validation error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'Invalid email or password' }) }))
  await expect(api('/auth/login')).rejects.toMatchObject({ status: 401, message: 'Invalid email or password' })
})
