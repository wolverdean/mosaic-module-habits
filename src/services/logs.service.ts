import type { Database } from 'better-sqlite3'
import type { Habit }    from './habits.service.js'

export interface HabitLog {
  id:         number
  habit_id:   number
  user_id:    number
  log_date:   string
  notes:      string
  rating:     number | null
  created_at: string
}

export function getMondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const day = d.getUTCDay()              // 0=Sun, 1=Mon … 6=Sat
  const diff = day === 0 ? -6 : 1 - day // shift to Monday
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function logHabit(
  db:      Database,
  userId:  number,
  habitId: number,
  date:    string,
  notes:   string = '',
  rating?: number,
): HabitLog {
  const habit = db.prepare('SELECT * FROM habits_habits WHERE id = ? AND user_id = ?').get(habitId, userId) as Habit | undefined
  if (!habit) throw new Error(`Habit ${habitId} not found`)

  if (rating !== undefined && (rating < 1 || rating > 5 || !Number.isInteger(rating))) {
    throw new Error('rating must be an integer between 1 and 5')
  }

  try {
    const result = db.prepare(`
      INSERT INTO habits_logs (habit_id, user_id, log_date, notes, rating)
      VALUES (?, ?, ?, ?, ?)
    `).run(habitId, userId, date, notes, rating ?? null)
    return db.prepare('SELECT * FROM habits_logs WHERE id = ?').get(result.lastInsertRowid) as HabitLog
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) throw new Error(`Habit already logged for this period`)
    throw err
  }
}

export function unlogHabit(
  db:      Database,
  userId:  number,
  habitId: number,
  date:    string,
): void {
  const habit = db.prepare('SELECT * FROM habits_habits WHERE id = ? AND user_id = ?').get(habitId, userId) as Habit | undefined
  if (!habit) throw new Error(`Habit ${habitId} not found`)

  const result = db.prepare(
    'DELETE FROM habits_logs WHERE habit_id = ? AND user_id = ? AND log_date = ?'
  ).run(habitId, userId, date)

  if (result.changes === 0) throw new Error(`Log not found for ${date}`)
}

export function updateLog(
  db:      Database,
  userId:  number,
  habitId: number,
  date:    string,
  input:   { notes?: string; rating?: number | null },
): HabitLog {
  const habit = db.prepare('SELECT * FROM habits_habits WHERE id = ? AND user_id = ?').get(habitId, userId) as Habit | undefined
  if (!habit) throw new Error(`Habit ${habitId} not found`)

  if (input.rating !== undefined && input.rating !== null) {
    if (input.rating < 1 || input.rating > 5 || !Number.isInteger(input.rating)) {
      throw new Error('rating must be an integer between 1 and 5')
    }
  }

  const log = db.prepare(
    'SELECT * FROM habits_logs WHERE habit_id = ? AND user_id = ? AND log_date = ?'
  ).get(habitId, userId, date) as HabitLog | undefined
  if (!log) throw new Error(`Log not found for ${date}`)

  db.prepare(`
    UPDATE habits_logs SET
      notes  = COALESCE(?, notes),
      rating = ?
    WHERE habit_id = ? AND user_id = ? AND log_date = ?
  `).run(
    input.notes  !== undefined ? input.notes  : null,
    input.rating !== undefined ? input.rating : log.rating,
    habitId,
    userId,
    date,
  )

  return db.prepare('SELECT * FROM habits_logs WHERE habit_id = ? AND user_id = ? AND log_date = ?').get(habitId, userId, date) as HabitLog
}

export function getLogs(
  db:      Database,
  userId:  number,
  habitId: number,
  month:   string,   // YYYY-MM
): HabitLog[] {
  return db.prepare(`
    SELECT * FROM habits_logs
    WHERE habit_id = ? AND user_id = ? AND substr(log_date,1,7) = ?
    ORDER BY log_date ASC
  `).all(habitId, userId, month) as HabitLog[]
}

export function isLoggedToday(db: Database, habit: Habit, today: string): boolean {
  const row = db.prepare(
    'SELECT id FROM habits_logs WHERE habit_id = ? AND log_date = ?'
  ).get(habit.id, today)
  return !!row
}

export function isWeekComplete(db: Database, habit: Habit, today: string): boolean {
  if (habit.frequency !== 'weekly') return false
  const weekStart = getMondayOf(today)
  const weekEnd   = addDays(weekStart, 6)
  const count = (db.prepare(
    'SELECT COUNT(*) AS n FROM habits_logs WHERE habit_id = ? AND log_date >= ? AND log_date <= ?'
  ).get(habit.id, weekStart, weekEnd) as { n: number }).n
  return count >= habit.target_count
}
