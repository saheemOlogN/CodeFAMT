const baseUrl = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

export async function api(path, { method = 'GET', body, token, signal } = {}) {
  let response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      credentials: 'include',
      signal: signal || AbortSignal.timeout(20000),
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token && token !== 'cookie-session' ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('Could not reach the server. Please try again.')
  }
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) {
    const error = new Error(
      data?.message ||
        ([502, 503, 504].includes(response.status) || (!data && response.status >= 500)
          ? 'The server is restarting or unavailable. Wait a moment and try again.'
          : 'The server could not complete this request. Please try again.'),
    )
    error.status = response.status
    throw error
  }
  return data
}
