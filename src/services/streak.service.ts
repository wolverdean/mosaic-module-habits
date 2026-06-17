import type { Database } from 'better-sqlite3'
import type { Habit }    from './habits.service.js'
import { getMondayOf }   from './logs.service.js'

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function effectiveTarget(t: number | null | undefined): number {
  return Math.max(1, t ?? 1)
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

function dailyStreak(db: Database, habit: Habit, today: string, pauseWindows: PauseWindow[] = [], pausedSince?: string | null): number {
  const target = effectiveTarget(habit.target_count)

  // Fetch all log dates + counts for this habit, ordered desc
  const rows = db.prepare(
    'SELECT log_date, COALESCE(count, 1) as count FROM habits_logs WHERE habit_id = ? ORDER BY log_date DESC'
  ).all(habit.id) as { log_date: string; count: number }[]

  if (rows.length === 0) return 0

  // Filter to only days where count meets target
  const completeDays = rows.filter(r => r.count >= target)
  if (completeDays.length === 0) return 0

  // If the habit is currently paused, start from the day before paused_since
  const startDate = pausedSince ? addDays(pausedSince, -1) : today

  // Start from startDate; if not logged, try from the day before
  let cursor = completeDays[0].log_date === startDate ? startDate : addDays(startDate, -1)
  if (completeDays[0].log_date !== cursor) return 0  // most recent complete log is older than yesterday (relative to startDate)

  const dateSet = new Set(completeDays.map(r => r.log_date))
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
    'SELECT log_date, COALESCE(count, 1) as count FROM habits_logs WHERE habit_id = ? ORDER BY log_date DESC'
  ).all(habit.id) as { log_date: string; count: number }[]

  if (rows.length === 0) return 0

  // Group logs by week (Monday), summing count per week
  const weekCounts = new Map<string, number>()
  for (const row of rows) {
    const monday = getMondayOf(row.log_date)
    weekCounts.set(monday, (weekCounts.get(monday) ?? 0) + row.count)
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
    : dailyStreak(db, habit, today, pauseWindows, habit.paused_since)
}

export function getLongestStreak(db: Database, habit: Habit): number {
  const target = effectiveTarget(habit.target_count)

  if (habit.frequency === 'weekly') {
    const rows = db.prepare(
      'SELECT log_date, COALESCE(count, 1) as count FROM habits_logs WHERE habit_id = ? ORDER BY log_date ASC'
    ).all(habit.id) as { log_date: string; count: number }[]

    if (rows.length === 0) return 0

    const weekCounts = new Map<string, number>()
    for (const row of rows) {
      const monday = getMondayOf(row.log_date)
      weekCounts.set(monday, (weekCounts.get(monday) ?? 0) + row.count)
    }
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

  // Daily — filter by count >= target
  const rows = db.prepare(
    'SELECT log_date, COALESCE(count, 1) as count FROM habits_logs WHERE habit_id = ? ORDER BY log_date ASC'
  ).all(habit.id) as { log_date: string; count: number }[]

  if (rows.length === 0) return 0

  const completeDays = rows.filter(r => r.count >= target).map(r => r.log_date)
  if (completeDays.length === 0) return 0

  let longest = 1, current = 1
  for (let i = 1; i < completeDays.length; i++) {
    if (addDays(completeDays[i - 1], 1) === completeDays[i]) {
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

  if (habit.frequency === 'daily') {
    const rows = db.prepare(
      `SELECT COALESCE(count, 1) as count FROM habits_logs
       WHERE habit_id = ? AND user_id = ? AND log_date >= ? AND log_date <= ?`
    ).all(habit.id, habit.user_id, from, today) as { count: number }[]

    const target = effectiveTarget(habit.target_count)
    const achieved = rows.reduce((sum, r) => sum + Math.min(r.count, target), 0)

    // Count pause days that overlap the 30-day window
    let pauseDays = 0
    for (const w of pauseWindows) {
      const wFrom = w.from < from ? from : w.from
      const wTo   = w.to   > today ? today : w.to
      if (wFrom <= wTo) {
        const ms = new Date(`${wTo}T00:00:00Z`).getTime() - new Date(`${wFrom}T00:00:00Z`).getTime()
        pauseDays += Math.floor(ms / 86400000) + 1
      }
    }
    const activeDays = Math.max(1, 30 - pauseDays)
    const denominator = target * activeDays
    return Math.min(100, Math.round((achieved / denominator) * 100))
  }

  // Weekly: proportionally adjust for pause windows
  const actual = (db.prepare(
    'SELECT COALESCE(SUM(count), 0) AS n FROM habits_logs WHERE habit_id = ? AND log_date >= ? AND log_date <= ?'
  ).get(habit.id, from, today) as { n: number }).n
  const expected = 4 * (habit.target_count ?? 1)
  return Math.min(100, Math.round((actual / expected) * 100))
}
