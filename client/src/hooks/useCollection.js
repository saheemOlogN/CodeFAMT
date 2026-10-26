import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/auth'

// The API has no text search. Load paginated metadata before filtering locally.
export function useCollection(path, field) {
  const { token, clearSession } = useAuth()
  const [state, setState] = useState({ data: null, loading: true, error: '' })
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    setState(previous => ({ ...previous, loading: true, error: '' }))
    async function load() {
      let items = [], response, page = 1
      do {
        response = await api(`${path}${path.includes('?') ? '&' : '?'}limit=100&page=${page++}`, {
          token, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        })
        items = items.concat(response[field] || [])
      } while (items.length < response.total && response[field]?.length)
      if (!controller.signal.aborted) setState({ data: { ...response, [field]: items }, loading: false, error: '' })
    }
    load().catch(error => {
      if (controller.signal.aborted) return
      if (error.status === 401) clearSession()
      setState(previous => ({ ...previous, loading: false, error: error.message }))
    })
    return () => controller.abort()
  }, [path, field, token, clearSession, revision])
  return { ...state, reload }
}
