import type { Database } from 'better-sqlite3'
import type { Habit }    from './habits.service.js'

export interface HabitLog {
  id:         number
  habit_id:   number
  user_id:    number
  log_date:   string
  notes:      string
  created_at: string
}

export function getMondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const day = d.getUTCDay()              // 0=Sun, 1=Mon … 6=Sat
  const diff = day === 0 ? -6 : 1 - day // shift to Monday
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}

function canonicalDate(habit: Pick<Habit, 'frequency'>, date: string): string {
  return habit.frequency === 'weekly' ? getMondayOf(date) : date
}

export function logHabit(
  db:      Database,
  userId:  number,
  habitId: number,
  date:    string,
  notes:   string = '',
): HabitLog {
  const habit = db.prepare('SELECT * FROM habits_habits WHERE id = ? AND user_id = ?').get(habitId, userId) as Habit | undefined
  if (!habit) throw new Error(`Habit ${habitId} not found`)

  const logDate = canonicalDate(habit, date)

  try {
    const result = db.prepare(`
      INSERT INTO habits_logs (habit_id, user_id, log_date, notes)
      VALUES (?, ?, ?, ?)
    `).run(habitId, userId, logDate, notes)
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

  const logDate = canonicalDate(habit, date)
  const result = db.prepare(
    'DELETE FROM habits_logs WHERE habit_id = ? AND user_id = ? AND log_date = ?'
  ).run(habitId, userId, logDate)

  if (result.changes === 0) throw new Error(`Log not found for ${logDate}`)
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
  const checkDate = canonicalDate(habit, today)
  const row = db.prepare(
    'SELECT id FROM habits_logs WHERE habit_id = ? AND log_date = ?'
  ).get(habit.id, checkDate)
  return !!row
}
