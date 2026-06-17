import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import {
  listHabits,
  getHabit,
  createHabit,
  updateHabit,
  archiveHabit,
  pauseHabit,
  resumeHabit,
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

  it('defaults target_count to 1', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly' })
    expect(h.target_count).toBe(1)
  })

  it('stores a custom target_count', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly', target_count: 3 })
    expect(h.target_count).toBe(3)
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

  it('updates target_count', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly' })
    const updated = updateHabit(db, 1, h.id, { target_count: 4 })
    expect(updated?.target_count).toBe(4)
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

  it('writes a non-null archived_at timestamp', () => {
    const h = createHabit(db, 1, { name: 'Done' })
    archiveHabit(db, 1, h.id)
    const archived = getHabit(db, 1, h.id)
    expect(archived?.archived_at).not.toBeNull()
    expect(typeof archived?.archived_at).toBe('string')
  })
})

describe('pauseHabit', () => {
  it('sets paused_since and leaves active = 1', () => {
    const h = createHabit(db, 1, { name: 'Walk' })
    const paused = pauseHabit(db, 1, h.id, '2026-06-12')
    expect(paused).toBeDefined()
    expect(paused?.paused_since).toBe('2026-06-12')
    expect(paused?.active).toBe(1)
  })

  it('returns undefined for an already-paused (not yet resumed) habit', () => {
    const h = createHabit(db, 1, { name: 'Walk' })
    pauseHabit(db, 1, h.id, '2026-06-12')
    const result = pauseHabit(db, 1, h.id, '2026-06-13')
    expect(result).toBeUndefined()
  })

  it('returns undefined for a habit owned by another user', () => {
    const h = createHabit(db, 1, { name: 'Walk' })
    expect(pauseHabit(db, 2, h.id, '2026-06-12')).toBeUndefined()
  })
})

describe('resumeHabit', () => {
  it('sets resumed_at and leaves paused_since intact (isPaused becomes false)', () => {
    const h = createHabit(db, 1, { name: 'Walk' })
    pauseHabit(db, 1, h.id, '2026-06-12')
    const resumed = resumeHabit(db, 1, h.id, '2026-06-15')
    expect(resumed).toBeDefined()
    // paused_since preserved — pause window is now [paused_since, resumed_at]
    expect(resumed?.paused_since).toBe('2026-06-12')
    expect(resumed?.resumed_at).toBe('2026-06-15')
    // isPaused = paused_since IS NOT NULL AND resumed_at IS NULL → false now
    const isPaused = !!resumed?.paused_since && !resumed?.resumed_at
    expect(isPaused).toBe(false)
  })

  it('returns undefined for a habit that is not paused', () => {
    const h = createHabit(db, 1, { name: 'Walk' })
    expect(resumeHabit(db, 1, h.id, '2026-06-15')).toBeUndefined()
  })

  it('returns undefined for a habit that is already resumed', () => {
    const h = createHabit(db, 1, { name: 'Walk' })
    pauseHabit(db, 1, h.id, '2026-06-12')
    resumeHabit(db, 1, h.id, '2026-06-15')
    // Second resume call should return undefined
    expect(resumeHabit(db, 1, h.id, '2026-06-16')).toBeUndefined()
  })

  it('allows re-pausing after a resume', () => {
    const h = createHabit(db, 1, { name: 'Walk' })
    pauseHabit(db, 1, h.id, '2026-06-12')
    resumeHabit(db, 1, h.id, '2026-06-15')
    // Re-pausing should work and reset the window
    const repaused = pauseHabit(db, 1, h.id, '2026-06-20')
    expect(repaused).toBeDefined()
    expect(repaused?.paused_since).toBe('2026-06-20')
    expect(repaused?.resumed_at).toBeNull()
  })
})

describe('archiveHabit — clears pause state', () => {
  it('sets paused_since and resumed_at to NULL when archiving a paused habit', () => {
    const h = createHabit(db, 1, { name: 'Walk' })
    pauseHabit(db, 1, h.id, '2026-06-12')
    archiveHabit(db, 1, h.id)
    const archived = getHabit(db, 1, h.id)
    expect(archived?.active).toBe(0)
    expect(archived?.paused_since).toBeNull()
    expect(archived?.resumed_at).toBeNull()
  })
})

describe('createHabit — reminder_time', () => {
  it('stores reminder_time when provided', () => {
    const h = createHabit(db, 1, { name: 'Walk', reminder_time: '07:30' })
    expect(h.reminder_time).toBe('07:30')
  })

  it('stores null reminder_time when not provided', () => {
    const h = createHabit(db, 1, { name: 'Walk' })
    expect(h.reminder_time).toBeNull()
  })
})

describe('updateHabit — reminder_time', () => {
  it('can set reminder_time', () => {
    const h = createHabit(db, 1, { name: 'Walk' })
    const updated = updateHabit(db, 1, h.id, { reminder_time: '08:00' })
    expect(updated?.reminder_time).toBe('08:00')
  })

  it('can clear reminder_time to null', () => {
    const h = createHabit(db, 1, { name: 'Walk', reminder_time: '08:00' })
    const updated = updateHabit(db, 1, h.id, { reminder_time: null })
    expect(updated?.reminder_time).toBeNull()
  })
})
