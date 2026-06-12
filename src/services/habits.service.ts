import type { Database } from 'better-sqlite3'

export interface Habit {
  id:          number
  user_id:     number
  name:        string
  frequency:   'daily' | 'weekly'
  description: string
  color:       string
  emoji:       string
  sort_order:  number
  active:      number
  created_at:  string
}

export interface CreateHabitInput {
  name:        string
  frequency?:  'daily' | 'weekly'
  description?: string
  color?:      string
  emoji?:      string
}

export function createHabit(db: Database, userId: number, input: CreateHabitInput): Habit {
  const result = db.prepare(`
    INSERT INTO habits_habits (user_id, name, frequency, description, color, emoji)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    input.name.trim(),
    input.frequency  ?? 'daily',
    input.description ?? '',
    input.color       ?? '#6366f1',
    input.emoji       ?? '',
  )
  return db.prepare('SELECT * FROM habits_habits WHERE id = ?').get(result.lastInsertRowid) as Habit
}

export function listHabits(
  db:      Database,
  userId:  number,
  options: { includeArchived?: boolean } = {},
): Habit[] {
  const sql = options.includeArchived
    ? 'SELECT * FROM habits_habits WHERE user_id = ? ORDER BY sort_order, id'
    : 'SELECT * FROM habits_habits WHERE user_id = ? AND active = 1 ORDER BY sort_order, id'
  return db.prepare(sql).all(userId) as Habit[]
}

export function getHabit(db: Database, userId: number, id: number): Habit | undefined {
  return db.prepare('SELECT * FROM habits_habits WHERE id = ? AND user_id = ?').get(id, userId) as Habit | undefined
}

export function updateHabit(
  db:     Database,
  userId: number,
  id:     number,
  input:  Partial<Pick<Habit, 'name' | 'description' | 'color' | 'emoji' | 'active' | 'sort_order'>>,
): Habit | undefined {
  const habit = getHabit(db, userId, id)
  if (!habit) return undefined

  db.prepare(`
    UPDATE habits_habits SET
      name        = COALESCE(?, name),
      description = COALESCE(?, description),
      color       = COALESCE(?, color),
      emoji       = COALESCE(?, emoji),
      active      = COALESCE(?, active),
      sort_order  = COALESCE(?, sort_order)
    WHERE id = ? AND user_id = ?
  `).run(
    input.name        !== undefined ? input.name.trim() : null,
    input.description !== undefined ? input.description : null,
    input.color       !== undefined ? input.color       : null,
    input.emoji       !== undefined ? input.emoji       : null,
    input.active      !== undefined ? input.active      : null,
    input.sort_order  !== undefined ? input.sort_order  : null,
    id,
    userId,
  )
  return getHabit(db, userId, id)
}

export function archiveHabit(db: Database, userId: number, id: number): void {
  db.prepare('UPDATE habits_habits SET active = 0 WHERE id = ? AND user_id = ?').run(id, userId)
}
