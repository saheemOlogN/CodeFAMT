export function activityCalendar(year, records = [], today) {
  const counts = new Map(records.map(item => [item.date, item.count]))
  const days = []
  let total = 0, activeDays = 0, streak = 0, longestStreak = 0
  const start = new Date(Date.UTC(year, 0, 1))
  for (const date = new Date(start); date.getUTCFullYear() === year; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = date.toISOString().slice(0, 10)
    const future = key > today
    const count = future ? 0 : counts.get(key) || 0
    days.push({ date: key, count, future, month: date.getUTCMonth(), firstOfMonth: date.getUTCDate() === 1 })
    total += count
    if (count) { activeDays++; streak++; longestStreak = Math.max(streak, longestStreak) } else streak = 0
  }
  return { days, offset: start.getUTCDay(), total, activeDays, longestStreak }
}

export function activityLevel(count) {
  return count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4
}
