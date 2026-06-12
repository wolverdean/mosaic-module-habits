import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import {
  listHabits,
  getHabit,
  createHabit,
  updateHabit,
  archiveHabit,
} from '../../src/services/habits.service.js'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.prepare(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)`).run()
  db.prepare(`INSERT INTO users VALUES (1,'a@b.com'),(2,'b@b.com')`).run()
  migrate({ exec: (sql: string) => db.exec(sql), prepare: db.prepare.bind(db), transaction: (fn: () => unknown) => { const t = db.transaction(fn); return t() }, raw: db } as any)
  return db
}

let db: Database.Database
beforeEach(() => { db = makeDb() })

describe('createHabit', () => {
  it('creates a daily habit with defaults', () => {
    const h = createHabit(db, 1, { name: 'Morning walk' })
    expect(h.id).toBeGreaterThan(0)
    expect(h.name).toBe('Morning walk')
    expect(h.frequency).toBe('daily')
    expect(h.active).toBe(1)
  })

  it('creates a weekly habit', () => {
    const h = createHabit(db, 1, { name: 'Long run', frequency: 'weekly' })
    expect(h.frequency).toBe('weekly')
  })

  it('stores description, color, emoji', () => {
    const h = createHabit(db, 1, { name: 'Read', description: 'Read 30 min', color: '#ff0000', emoji: '📚' })
    expect(h.description).toBe('Read 30 min')
    expect(h.color).toBe('#ff0000')
    expect(h.emoji).toBe('📚')
  })
})

describe('listHabits', () => {
  it('returns only active habits for the user', () => {
    createHabit(db, 1, { name: 'A' })
    createHabit(db, 1, { name: 'B' })
    createHabit(db, 2, { name: 'C' })
    const list = listHabits(db, 1)
    expect(list).toHaveLength(2)
    expect(list.every(h => h.user_id === 1)).toBe(true)
  })

  it('excludes archived habits by default', () => {
    const h = createHabit(db, 1, { name: 'Old' })
    archiveHabit(db, 1, h.id)
    expect(listHabits(db, 1)).toHaveLength(0)
  })

  it('includes archived habits when flag is set', () => {
    const h = createHabit(db, 1, { name: 'Old' })
    archiveHabit(db, 1, h.id)
    expect(listHabits(db, 1, { includeArchived: true })).toHaveLength(1)
  })
})

describe('getHabit', () => {
  it('returns the habit for the owning user', () => {
    const h = createHabit(db, 1, { name: 'Test' })
    expect(getHabit(db, 1, h.id)).toBeDefined()
  })

  it('returns undefined for another user', () => {
    const h = createHabit(db, 1, { name: 'Test' })
    expect(getHabit(db, 2, h.id)).toBeUndefined()
  })
})

describe('updateHabit', () => {
  it('updates name and emoji', () => {
    const h = createHabit(db, 1, { name: 'Walk' })
    const updated = updateHabit(db, 1, h.id, { name: 'Run', emoji: '🏃' })
    expect(updated?.name).toBe('Run')
    expect(updated?.emoji).toBe('🏃')
  })

  it('returns undefined when habit not found', () => {
    expect(updateHabit(db, 1, 999, { name: 'X' })).toBeUndefined()
  })
})

describe('archiveHabit', () => {
  it('sets active=0', () => {
    const h = createHabit(db, 1, { name: 'Done' })
    archiveHabit(db, 1, h.id)
    expect(getHabit(db, 1, h.id)?.active).toBe(0)
  })

  it('does nothing for a habit owned by another user', () => {
    const h = createHabit(db, 1, { name: 'Mine' })
    archiveHabit(db, 2, h.id)
    expect(getHabit(db, 1, h.id)?.active).toBe(1)
  })
})
