import type { ModuleDb } from '@mosaic/sdk'

export function migrate(db: ModuleDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS habits_habits (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         TEXT    NOT NULL,
      frequency    TEXT    NOT NULL DEFAULT 'daily'
                     CHECK(frequency IN ('daily','weekly')),
      target_count INTEGER NOT NULL DEFAULT 1,
      description  TEXT    NOT NULL DEFAULT '',
      color        TEXT    NOT NULL DEFAULT '#6366f1',
      emoji        TEXT    NOT NULL DEFAULT '',
      sort_order   INTEGER NOT NULL DEFAULT 0,
      active       INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Inline migration — add target_count if upgrading from older schema
  const habitCols = (db.prepare('PRAGMA table_info(habits_habits)').all() as { name: string }[]).map(r => r.name)
  if (!habitCols.includes('target_count')) {
    db.exec('ALTER TABLE habits_habits ADD COLUMN target_count INTEGER NOT NULL DEFAULT 1')
  }

  // Inline migration — add pause/archive/reminder columns
  const habitCols2 = (db.prepare('PRAGMA table_info(habits_habits)').all() as { name: string }[]).map(r => r.name)
  if (!habitCols2.includes('paused_since')) {
    db.exec('ALTER TABLE habits_habits ADD COLUMN paused_since TEXT')
  }
  if (!habitCols2.includes('archived_at')) {
    db.exec('ALTER TABLE habits_habits ADD COLUMN archived_at TEXT')
  }
  if (!habitCols2.includes('reminder_time')) {
    db.exec('ALTER TABLE habits_habits ADD COLUMN reminder_time TEXT')
  }
  if (!habitCols2.includes('resumed_at')) {
    db.exec('ALTER TABLE habits_habits ADD COLUMN resumed_at TEXT')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS habits_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      habit_id   INTEGER NOT NULL REFERENCES habits_habits(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      log_date   TEXT    NOT NULL,
      notes      TEXT    NOT NULL DEFAULT '',
      rating     INTEGER,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(habit_id, log_date)
    )
  `)

  // Inline migration — add rating if upgrading from older schema
  const logCols = (db.prepare('PRAGMA table_info(habits_logs)').all() as { name: string }[]).map(r => r.name)
  if (!logCols.includes('rating')) {
    db.exec('ALTER TABLE habits_logs ADD COLUMN rating INTEGER')
  }

  // Inline migration — add count column to habits_logs
  const logsCols2 = (db.prepare('PRAGMA table_info(habits_logs)').all() as { name: string }[]).map(r => r.name)
  if (!logsCols2.includes('count')) {
    db.exec('ALTER TABLE habits_logs ADD COLUMN count INTEGER NOT NULL DEFAULT 1')
  }

  // Inline migration — add category_id column to habits_habits
  const habitCols3 = (db.prepare('PRAGMA table_info(habits_habits)').all() as { name: string }[]).map(r => r.name)
  if (!habitCols3.includes('category_id')) {
    db.exec('ALTER TABLE habits_habits ADD COLUMN category_id INTEGER REFERENCES habit_categories(id) ON DELETE SET NULL')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS habit_categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL CHECK(length(name) <= 64),
      color      TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(user_id, name)
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS habits_weekly_reviews (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_start   TEXT    NOT NULL,
      week_end     TEXT    NOT NULL,
      content      TEXT    NOT NULL,
      generated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(user_id, week_end)
    )
  `)

  db.exec(`CREATE INDEX IF NOT EXISTS habits_logs_user_date     ON habits_logs(user_id, log_date)`)
  db.exec(`CREATE INDEX IF NOT EXISTS habits_habits_user        ON habits_habits(user_id, active)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_habit_categories_user ON habit_categories(user_id, sort_order)`)
}
