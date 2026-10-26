import { useEffect, useState } from 'react'

export function useServerClock(serverNow) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const offset = serverNow ? new Date(serverNow).getTime() - Date.now() : 0
    const tick = () => setNow(Date.now() + offset)
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [serverNow])
  return now
}
