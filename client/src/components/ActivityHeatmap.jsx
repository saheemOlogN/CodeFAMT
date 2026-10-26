import { useEffect, useRef, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../context/auth'
import { useRealtime } from '../context/RealtimeProvider'
import { activityCalendar, activityLevel } from '../activity'
import { LoadState } from './PlatformUI'

export default function ActivityHeatmap() {
  const { user } = useAuth()
  const currentYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(new Date()))
  const joinedYear = user.createdAt ? new Date(user.createdAt).getFullYear() : currentYear
  const firstYear = Number.isFinite(joinedYear) ? Math.min(currentYear, Math.max(2000, joinedYear)) : currentYear
  const [year, setYear] = useState(currentYear)
  const { data, loading, error, reload } = useApi(`/users/me/activity?year=${year}`)
  const socket = useRealtime()
  useEffect(() => {
    socket?.on('submission:updated', reload)
    socket?.on('connect', reload)
    return () => { socket?.off('submission:updated', reload); socket?.off('connect', reload) }
  }, [socket, reload])
  return <section className="activity-panel" aria-labelledby="activity-heading">
    <div className="activity-heading"><h2 id="activity-heading">Submission activity</h2><select aria-label="Activity year" value={year} onChange={event => setYear(Number(event.target.value))}>{Array.from({ length: currentYear - firstYear + 1 }, (_, i) => <option key={i} value={currentYear - i}>{currentYear - i}</option>)}</select></div>
    <LoadState loading={loading} error={error} retry={reload} />
    {!loading && !error && data && <Calendar key={year} data={data} />}
  </section>
}

function Calendar({ data }) {
  const { days, offset, total, activeDays, longestStreak } = activityCalendar(data.year, data.days, data.today)
  const [selected, setSelected] = useState(Math.max(0, days.findIndex(day => day.date === data.today)))
  const buttons = useRef([])
  function move(event, index) {
    const delta = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1, Home: -index, End: days.length - 1 - index }[event.key]
    if (delta === undefined) return
    event.preventDefault()
    const next = Math.max(0, Math.min(days.length - 1, index + delta))
    setSelected(next)
    buttons.current[next]?.focus()
  }
  const describe = day => `${day.date}: ${day.future ? 'Future date' : `${day.count} submission${day.count === 1 ? '' : 's'}`}`
  const weeks = Math.ceil((offset + days.length) / 7)
  return <>
    <div className="activity-stats"><div><strong>{total}</strong><span>Submissions in {data.year}</span></div><div><strong>{activeDays}</strong><span>Active days</span></div><div><strong>{longestStreak}<small> days</small></strong><span>Longest streak</span></div></div>
    <div className="heatmap-scroll" role="group" aria-label={`Daily submission activity for ${data.year}. Use arrow keys to explore dates.`}>
      <div className="heatmap-calendar" style={{ '--weeks': weeks }}>
        <div className="heatmap-months" aria-hidden="true">{days.map((day, index) => day.firstOfMonth && <span key={day.date} style={{ gridColumn: Math.floor((offset + index) / 7) + 1 }}>{new Date(`${day.date}T00:00:00Z`).toLocaleString('en', { month: 'short', timeZone: 'UTC' })}</span>)}</div>
        <div className="heatmap-days">
          {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} />)}
          {days.map((day, index) => <button key={day.date} ref={element => { buttons.current[index] = element }} className={`heatmap-day heat-${activityLevel(day.count)}${day.future ? ' heat-future' : ''}`} title={describe(day)} aria-label={describe(day)} tabIndex={index === selected ? 0 : -1} onKeyDown={event => move(event, index)} onFocus={() => setSelected(index)} onClick={() => setSelected(index)} onMouseEnter={() => setSelected(index)} />)}
        </div>
      </div>
    </div>
    <div className="heatmap-footer"><span aria-live="polite">{describe(days[selected])}</span><div className="heatmap-legend" aria-label="Darker to brighter green represents more submissions"><span>Less</span>{[0, 1, 2, 3, 4].map(level => <i key={level} className={`heatmap-day heat-${level}`} />)}<span>More</span></div></div>
    <p className="activity-note">All submissions · India time (IST). Custom runs are not included.</p>
  </>
}
