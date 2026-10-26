import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/auth'

export function useApi(path) {
  const { token, clearSession } = useAuth()
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState({ path: null, data: null, loading: true, error: '' })
  const reload = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    if (!path || !token) return
    const controller = new AbortController()
    setState(previous => ({ path, data: previous.path === path ? previous.data : null, loading: true, error: '' }))
    api(path, { token, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) })
      .then(data => { if (!controller.signal.aborted) setState({ path, data, loading: false, error: '' }) })
      .catch(error => {
        if (controller.signal.aborted) return
        if (error.status === 401) clearSession()
        setState(previous => ({ ...previous, loading: false, error: error.message }))
      })
    return () => controller.abort()
  }, [path, token, revision, clearSession])
  return { ...(state.path === path ? state : { data: null, loading: Boolean(path), error: '' }), reload }
}
