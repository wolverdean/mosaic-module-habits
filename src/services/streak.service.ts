import type { Database } from 'better-sqlite3'
import type { Habit }    from './habits.service.js'
import { getMondayOf }   from './logs.service.js'

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function dailyStreak(db: Database, habitId: number, today: string): number {
  // Fetch all log dates for this habit, ordered desc
  const rows = db.prepare(
    'SELECT log_date FROM habits_logs WHERE habit_id = ? ORDER BY log_date DESC'
  ).all(habitId) as { log_date: string }[]

  if (rows.length === 0) return 0

  // Start from today; if today not logged, try from yesterday
  let cursor = rows[0].log_date === today ? today : addDays(today, -1)
  if (rows[0].log_date !== cursor) return 0  // most recent log is older than yesterday

  const dateSet = new Set(rows.map(r => r.log_date))
  let count = 0
  while (dateSet.has(cursor)) {
    count++
    cursor = addDays(cursor, -1)
  }
  return count
}

function weeklyStreak(db: Database, habitId: number, today: string): number {
  const rows = db.prepare(
    'SELECT log_date FROM habits_logs WHERE habit_id = ? ORDER BY log_date DESC'
  ).all(habitId) as { log_date: string }[]

  if (rows.length === 0) return 0

  const thisWeek = getMondayOf(today)
  const lastWeek = addDays(thisWeek, -7)

  // Start from this week if logged, else from last week
  const dateSet = new Set(rows.map(r => r.log_date))
  let cursor = dateSet.has(thisWeek) ? thisWeek : lastWeek
  if (!dateSet.has(cursor)) return 0

  let count = 0
  while (dateSet.has(cursor)) {
    count++
    cursor = addDays(cursor, -7)
  }
  return count
}

export function getStreak(db: Database, habit: Habit, today: string): number {
  return habit.frequency === 'weekly'
    ? weeklyStreak(db, habit.id, today)
    : dailyStreak(db, habit.id, today)
}
