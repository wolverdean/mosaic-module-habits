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

function weeklyStreak(db: Database, habit: Habit, today: string): number {
  const rows = db.prepare(
    'SELECT log_date FROM habits_logs WHERE habit_id = ? ORDER BY log_date DESC'
  ).all(habit.id) as { log_date: string }[]

  if (rows.length === 0) return 0

  // Group logs by week (Monday)
  const weekCounts = new Map<string, number>()
  for (const row of rows) {
    const monday = getMondayOf(row.log_date)
    weekCounts.set(monday, (weekCounts.get(monday) ?? 0) + 1)
  }

  const target   = habit.target_count ?? 1
  const thisWeek = getMondayOf(today)
  const lastWeek = addDays(thisWeek, -7)

  let cursor = (weekCounts.get(thisWeek) ?? 0) >= target ? thisWeek : lastWeek
  if ((weekCounts.get(cursor) ?? 0) < target) return 0

  let count = 0
  while ((weekCounts.get(cursor) ?? 0) >= target) {
    count++
    cursor = addDays(cursor, -7)
  }
  return count
}

export function getStreak(db: Database, habit: Habit, today: string): number {
  return habit.frequency === 'weekly'
    ? weeklyStreak(db, habit, today)
    : dailyStreak(db, habit.id, today)
}

export function getLongestStreak(db: Database, habit: Habit): number {
  const rows = db.prepare(
    'SELECT log_date FROM habits_logs WHERE habit_id = ? ORDER BY log_date ASC'
  ).all(habit.id) as { log_date: string }[]

  if (rows.length === 0) return 0

  if (habit.frequency === 'weekly') {
    const weekCounts = new Map<string, number>()
    for (const row of rows) {
      const monday = getMondayOf(row.log_date)
      weekCounts.set(monday, (weekCounts.get(monday) ?? 0) + 1)
    }
    const target = habit.target_count ?? 1
    const completeWeeks = Array.from(weekCounts.entries())
      .filter(([, count]) => count >= target)
      .map(([monday]) => monday)
      .sort()

    if (completeWeeks.length === 0) return 0
    let longest = 1, current = 1
    for (let i = 1; i < completeWeeks.length; i++) {
      if (addDays(completeWeeks[i - 1], 7) === completeWeeks[i]) {
        current++
        if (current > longest) longest = current
      } else {
        current = 1
      }
    }
    return longest
  }

  let longest = 1, current = 1
  for (let i = 1; i < rows.length; i++) {
    if (addDays(rows[i - 1].log_date, 1) === rows[i].log_date) {
      current++
      if (current > longest) longest = current
    } else {
      current = 1
    }
  }
  return longest
}

export function getCompletionRate30d(db: Database, habit: Habit, today: string): number {
  const from = addDays(today, -29)
  const actual = (db.prepare(
    'SELECT COUNT(*) AS n FROM habits_logs WHERE habit_id = ? AND log_date >= ? AND log_date <= ?'
  ).get(habit.id, from, today) as { n: number }).n
  const expected = habit.frequency === 'daily' ? 30 : 4 * (habit.target_count ?? 1)
  return Math.min(100, Math.round((actual / expected) * 100))
}
