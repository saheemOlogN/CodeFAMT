import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { AuthContext } from './auth'

export function AuthProvider({ children }) {
  const [token, setToken] = useState(
    () => sessionStorage.getItem('codefamt-token') || 'cookie-session',
  )
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(Boolean(token))
  const [error, setError] = useState('')
  const currentToken = useRef(token)
  const sessionGeneration = useRef(0)

  const clearSession = useCallback(() => {
    sessionGeneration.current++
    sessionStorage.removeItem('codefamt-token')
    currentToken.current = ''
    setToken('')
    setUser(null)
    setError('')
    setLoading(false)
  }, [])

  const refreshUser = useCallback(
    (background = false) => {
      if (!token) return Promise.resolve()
      const generation = sessionGeneration.current
      return api('/users/me', { token })
        .then((data) => {
          if (currentToken.current !== token || sessionGeneration.current !== generation) return
          setUser(data.user)
          setError('')
        })
        .catch((failure) => {
          if (currentToken.current !== token || sessionGeneration.current !== generation) return
          if (failure.status === 401 || failure.status === 403) clearSession()
          else if (!background) setError(failure.message)
        })
        .finally(() => {
          if (currentToken.current === token && sessionGeneration.current === generation) setLoading(false)
        })
    },
    [token, clearSession],
  )

  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  useEffect(() => {
    if (!token) return
    function checkSession() {
      if (document.visibilityState === 'visible') refreshUser(true)
    }
    document.addEventListener('visibilitychange', checkSession)
    const timer = setInterval(checkSession, 60000)
    return () => {
      document.removeEventListener('visibilitychange', checkSession)
      clearInterval(timer)
    }
  }, [token, refreshUser])

  async function login(email, password) {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    // Only a non-secret marker is stored in JavaScript-accessible storage.
    // The browser sends the persistent HttpOnly cookie with API requests.
    sessionStorage.setItem('codefamt-token', 'cookie-session')
    sessionGeneration.current++
    currentToken.current = 'cookie-session'
    setUser(data.user)
    setToken('cookie-session')
    setLoading(false)
    setError('')
    return data.user
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST', token })
    } catch (failure) {
      if (failure.status !== 401 && failure.status !== 403) throw failure
    }
    clearSession()
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        error,
        login,
        logout,
        refreshUser,
        clearSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
