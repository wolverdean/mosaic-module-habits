import type { Database } from 'better-sqlite3'

export interface Habit {
  id:            number
  user_id:       number
  name:          string
  frequency:     'daily' | 'weekly'
  target_count:  number
  description:   string
  color:         string
  emoji:         string
  sort_order:    number
  active:        number
  created_at:    string
  paused_since:  string | null
  resumed_at:    string | null
  archived_at:   string | null
  reminder_time: string | null
}

export interface CreateHabitInput {
  name:          string
  frequency?:    'daily' | 'weekly'
  target_count?: number
  description?:  string
  color?:        string
  emoji?:        string
  reminder_time?: string | null
}

export function createHabit(db: Database, userId: number, input: CreateHabitInput): Habit {
  const result = db.prepare(`
    INSERT INTO habits_habits (user_id, name, frequency, target_count, description, color, emoji, reminder_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    input.name.trim(),
    input.frequency    ?? 'daily',
    input.target_count ?? 1,
    input.description  ?? '',
    input.color        ?? '#6366f1',
    input.emoji        ?? '',
    input.reminder_time ?? null,
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
  input:  Partial<Pick<Habit, 'name' | 'description' | 'color' | 'emoji' | 'active' | 'sort_order' | 'target_count' | 'paused_since' | 'reminder_time'>>,
): Habit | undefined {
  const habit = getHabit(db, userId, id)
  if (!habit) return undefined

  // Non-nullable fields: use COALESCE so omitted fields are unchanged
  db.prepare(`
    UPDATE habits_habits SET
      name         = COALESCE(?, name),
      description  = COALESCE(?, description),
      color        = COALESCE(?, color),
      emoji        = COALESCE(?, emoji),
      active       = COALESCE(?, active),
      sort_order   = COALESCE(?, sort_order),
      target_count = COALESCE(?, target_count)
    WHERE id = ? AND user_id = ?
  `).run(
    input.name         !== undefined ? input.name.trim()    : null,
    input.description  !== undefined ? input.description    : null,
    input.color        !== undefined ? input.color          : null,
    input.emoji        !== undefined ? input.emoji          : null,
    input.active       !== undefined ? input.active         : null,
    input.sort_order   !== undefined ? input.sort_order     : null,
    input.target_count !== undefined ? input.target_count   : null,
    id,
    userId,
  )

  // Nullable-clearable fields: use separate UPDATE statements so NULL can be set explicitly
  if ('paused_since' in input) {
    db.prepare('UPDATE habits_habits SET paused_since = ? WHERE id = ? AND user_id = ?')
      .run(input.paused_since ?? null, id, userId)
  }
  if ('reminder_time' in input) {
    db.prepare('UPDATE habits_habits SET reminder_time = ? WHERE id = ? AND user_id = ?')
      .run(input.reminder_time ?? null, id, userId)
  }

  return getHabit(db, userId, id)
}

export function archiveHabit(db: Database, userId: number, id: number): void {
  db.prepare(
    "UPDATE habits_habits SET active = 0, archived_at = datetime('now'), paused_since = NULL, resumed_at = NULL WHERE id = ? AND user_id = ?"
  ).run(id, userId)
}

export function pauseHabit(
  db:          Database,
  userId:      number,
  id:          number,
  pausedSince: string,
): Habit | undefined {
  const result = db.prepare(
    'UPDATE habits_habits SET paused_since = ?, resumed_at = NULL WHERE id = ? AND user_id = ? AND active = 1 AND (paused_since IS NULL OR resumed_at IS NOT NULL)'
  ).run(pausedSince, id, userId)
  if (result.changes === 0) return undefined
  return getHabit(db, userId, id)
}

export function resumeHabit(
  db:     Database,
  userId: number,
  id:     number,
  today:  string,
): Habit | undefined {
  const result = db.prepare(
    'UPDATE habits_habits SET resumed_at = ? WHERE id = ? AND user_id = ? AND paused_since IS NOT NULL AND resumed_at IS NULL'
  ).run(today, id, userId)
  if (result.changes === 0) return undefined
  return getHabit(db, userId, id)
}
