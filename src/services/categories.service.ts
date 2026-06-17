import type { Database } from 'better-sqlite3'

export interface HabitCategory {
  id:         number
  user_id:    number
  name:       string
  color:      string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export function listCategories(db: Database, userId: number): HabitCategory[] {
  return db.prepare(
    'SELECT * FROM habit_categories WHERE user_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(userId) as HabitCategory[]
}

export function getCategoryById(db: Database, userId: number, id: number): HabitCategory | null {
  const row = db.prepare(
    'SELECT * FROM habit_categories WHERE id = ? AND user_id = ?'
  ).get(id, userId) as HabitCategory | undefined
  return row ?? null
}

export function createCategory(
  db:     Database,
  userId: number,
  name:   string,
  color?: string | null,
): HabitCategory {
  // RETURNING * requires SQLite 3.35+; better-sqlite3 supports it
  const row = db.prepare(`
    INSERT INTO habit_categories (user_id, name, color)
    VALUES (?, ?, ?)
    RETURNING *
  `).get(userId, name, color ?? null) as HabitCategory
  return row
}

export function updateCategory(
  db:     Database,
  userId: number,
  id:     number,
  fields: { name?: string; color?: string | null; sort_order?: number },
): HabitCategory | undefined {
  const existing = getCategoryById(db, userId, id)
  if (!existing) return undefined

  const setClauses: string[] = [
    `updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`
  ]
  const params: (string | number | null)[] = []

  if (fields.name !== undefined) {
    setClauses.push('name = ?')
    params.push(fields.name)
  }
  if ('color' in fields) {
    setClauses.push('color = ?')
    params.push(fields.color ?? null)
  }
  if (fields.sort_order !== undefined) {
    setClauses.push('sort_order = ?')
    params.push(fields.sort_order)
  }

  params.push(id, userId)

  db.prepare(
    `UPDATE habit_categories SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`
  ).run(...params)

  return getCategoryById(db, userId, id) ?? undefined
}

export function deleteCategory(db: Database, userId: number, id: number): boolean {
  const result = db.prepare(
    'DELETE FROM habit_categories WHERE id = ? AND user_id = ?'
  ).run(id, userId)
  return result.changes > 0
}
