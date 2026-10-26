import { createContext, useContext, useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import { useAuth } from './auth'

const RealtimeContext = createContext({ socket: null, status: 'offline' })
export const useRealtime = () => useContext(RealtimeContext).socket
export const useLiveStatus = () => useContext(RealtimeContext).status

export function RealtimeProvider({ children }) {
  const { token, refreshUser } = useAuth()
  const [connection, setConnection] = useState({ socket: null, status: 'offline' })
  useEffect(() => {
    if (!token) return
    const apiUrl = import.meta.env.VITE_API_URL
    const origin = import.meta.env.VITE_SOCKET_URL || (apiUrl ? new URL(apiUrl, window.location.origin).origin : undefined)
    const socket = io(origin, { transports: ['websocket'], withCredentials: true, auth: token === 'cookie-session' ? {} : { token } })
    setConnection({ socket, status: 'connecting' })
    socket.on('connect', () => setConnection({ socket, status: 'connected' }))
    socket.on('disconnect', reason => {
      setConnection({ socket, status: 'offline' })
      if (reason === 'io server disconnect') refreshUser(true)
    })
    socket.on('connect_error', () => setConnection({ socket, status: 'offline' }))
    return () => { socket.removeAllListeners(); socket.disconnect() }
  }, [token, refreshUser])
  return <RealtimeContext.Provider value={token ? connection : { socket: null, status: 'offline' }}>{children}</RealtimeContext.Provider>
}
