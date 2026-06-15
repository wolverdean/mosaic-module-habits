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

  db.exec(`CREATE INDEX IF NOT EXISTS habits_logs_user_date ON habits_logs(user_id, log_date)`)
  db.exec(`CREATE INDEX IF NOT EXISTS habits_habits_user    ON habits_habits(user_id, active)`)
}
