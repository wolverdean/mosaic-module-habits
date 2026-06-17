import type { Database } from 'better-sqlite3'
import type { Habit }    from './habits.service.js'
import { getMondayOf }   from './logs.service.js'

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export interface PauseWindow { from: string; to: string }

export function buildPauseWindows(habit: { paused_since: string | null; resumed_at?: string | null }, today: string): PauseWindow[] {
  if (!habit.paused_since) return []
  return [{ from: habit.paused_since, to: habit.resumed_at ?? today }]
}

/**
 * Returns the date one day before `from` for the first pause window that
 * contains `cursor`, or null if `cursor` is not in any pause window.
 */
function pauseWindowCeiling(cursor: string, pauseWindows: PauseWindow[]): string | null {
  for (const w of pauseWindows) {
    if (cursor >= w.from && cursor <= w.to) {
      return addDays(w.from, -1)
    }
  }
  return null
}

function dailyStreak(db: Database, habitId: number, today: string, pauseWindows: PauseWindow[] = [], pausedSince?: string | null): number {
  // Fetch all log dates for this habit, ordered desc
  const rows = db.prepare(
    'SELECT log_date FROM habits_logs WHERE habit_id = ? ORDER BY log_date DESC'
  ).all(habitId) as { log_date: string }[]

  if (rows.length === 0) return 0

  // If the habit is currently paused, start from the day before paused_since
  const startDate = pausedSince ? addDays(pausedSince, -1) : today

  // Start from startDate; if not logged, try from the day before
  let cursor = rows[0].log_date === startDate ? startDate : addDays(startDate, -1)
  if (rows[0].log_date !== cursor) return 0  // most recent log is older than yesterday (relative to startDate)

  const dateSet = new Set(rows.map(r => r.log_date))
  let count = 0
  while (dateSet.has(cursor)) {
    count++
    cursor = addDays(cursor, -1)
    // Skip over any pause window: jump cursor back to day before the window's start
    const skipTo = pauseWindowCeiling(cursor, pauseWindows)
    if (skipTo !== null) {
      cursor = skipTo
    }
  }
  return count
}

function weeklyStreak(db: Database, habit: Habit, today: string, pauseWindows: PauseWindow[] = []): number {
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
    const prevWeek = addDays(cursor, -7)

    // Skip weeks that are entirely within a pause window
    const weekEnd = addDays(cursor, -7) // the prev week's Monday
    const weekEndSun = addDays(weekEnd, 6)
    const isPaused = pauseWindows.some(w => weekEnd >= w.from && weekEndSun <= w.to)
    if (isPaused) {
      cursor = addDays(prevWeek, -7)
      continue
    }

    cursor = prevWeek
  }
  return count
}

export function getStreak(db: Database, habit: Habit, today: string, pauseWindows: PauseWindow[] = []): number {
  return habit.frequency === 'weekly'
    ? weeklyStreak(db, habit, today, pauseWindows)
    : dailyStreak(db, habit.id, today, pauseWindows, habit.paused_since)
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

export function getCompletionRate30d(db: Database, habit: Habit, today: string, pauseWindows: PauseWindow[] = []): number {
  const from = addDays(today, -29)
  const actual = (db.prepare(
    'SELECT COUNT(*) AS n FROM habits_logs WHERE habit_id = ? AND log_date >= ? AND log_date <= ?'
  ).get(habit.id, from, today) as { n: number }).n

  if (habit.frequency === 'daily') {
    // Count pause days that overlap the 30-day window
    let pauseDays = 0
    for (const w of pauseWindows) {
      const wFrom = w.from < from ? from : w.from
      const wTo   = w.to   > today ? today : w.to
      if (wFrom <= wTo) {
        // Count days in [wFrom, wTo] inclusive
        const ms = new Date(`${wTo}T00:00:00Z`).getTime() - new Date(`${wFrom}T00:00:00Z`).getTime()
        pauseDays += Math.floor(ms / 86400000) + 1
      }
    }
    const expected = Math.max(1, 30 - pauseDays)
    return Math.min(100, Math.round((actual / expected) * 100))
  }

  // Weekly: proportionally adjust for pause windows
  const expected = 4 * (habit.target_count ?? 1)
  return Math.min(100, Math.round((actual / expected) * 100))
}
