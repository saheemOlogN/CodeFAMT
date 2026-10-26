import { describe, expect, it } from 'vitest'
import { activityCalendar, activityLevel } from '../activity'

describe('Profile activity calendar', () => {
  it('renders leap years, month boundaries and gaps accurately', () => {
    const calendar = activityCalendar(2024, [{ date: '2024-02-28', count: 2 }, { date: '2024-02-29', count: 1 }, { date: '2024-03-01', count: 4 }, { date: '2024-03-03', count: 1 }], '2024-12-31')
    expect(calendar.days).toHaveLength(366)
    expect(calendar.offset).toBe(1)
    expect(calendar.total).toBe(8)
    expect(calendar.activeDays).toBe(4)
    expect(calendar.longestStreak).toBe(3)
    expect(calendar.days.filter(day => day.firstOfMonth)).toHaveLength(12)
  })
  it('handles empty years and ignores future counts', () => {
    const calendar = activityCalendar(2025, [{ date: '2025-12-31', count: 5 }], '2025-01-01')
    expect(calendar.days).toHaveLength(365)
    expect(calendar.total).toBe(0)
    expect(calendar.longestStreak).toBe(0)
    expect(calendar.days.at(-1).future).toBe(true)
    expect(calendar.days[0].future).toBe(false)
  })
  it('uses consistent submission intensity levels', () => {
    expect([0, 1, 2, 3, 5, 6, 9, 10, 100].map(activityLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4])
  })
})
