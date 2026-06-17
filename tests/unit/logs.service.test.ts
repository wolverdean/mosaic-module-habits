import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import { createHabit } from '../../src/services/habits.service.js'
import {
  logHabit,
  unlogHabit,
  updateLog,
  getLogs,
  isLoggedToday,
  isWeekComplete,
  getMondayOf,
  getDayLog,
} from '../../src/services/logs.service.js'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.prepare(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)`).run()
  db.prepare(`INSERT INTO users VALUES (1,'a@b.com')`).run()
  migrate({ exec: (sql: string) => db.exec(sql), prepare: db.prepare.bind(db), transaction: (fn: () => unknown) => { const t = db.transaction(fn); return t() }, raw: db } as any)
  return db
}

let db: Database.Database
beforeEach(() => { db = makeDb() })

describe('getMondayOf', () => {
  it('returns the same date for a Monday', () => {
    expect(getMondayOf('2026-06-08')).toBe('2026-06-08') // Monday
  })

  it('returns the Monday for a Wednesday', () => {
    expect(getMondayOf('2026-06-10')).toBe('2026-06-08')
  })

  it('returns the Monday for a Sunday', () => {
    expect(getMondayOf('2026-06-14')).toBe('2026-06-08')
  })

  it('handles week boundary crossing month boundary', () => {
    expect(getMondayOf('2026-06-01')).toBe('2026-06-01') // June 1 2026 is a Monday
  })
})

describe('logHabit — upsert / count semantics', () => {
  it('creates row with count=1 on first call', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    const log = logHabit(db, 1, h.id, '2026-06-10')
    expect(log.count).toBe(1)
    expect(log.log_date).toBe('2026-06-10')
  })

  it('increments count to 2 on second call same date', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10')
    const log = logHabit(db, 1, h.id, '2026-06-10')
    expect(log.count).toBe(2)
  })

  it('allows logging different dates', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10')
    logHabit(db, 1, h.id, '2026-06-11')
    expect(getLogs(db, 1, h.id, '2026-06')).toHaveLength(2)
  })
})

describe('logHabit — weekly', () => {
  it('stores the actual date (no Monday normalization)', () => {
    const h = createHabit(db, 1, { name: 'Long run', frequency: 'weekly' })
    const log = logHabit(db, 1, h.id, '2026-06-10') // Wednesday
    expect(log.log_date).toBe('2026-06-10')
  })

  it('allows multiple logs in the same week (for target_count > 1)', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly', target_count: 3 })
    logHabit(db, 1, h.id, '2026-06-08') // Mon
    logHabit(db, 1, h.id, '2026-06-10') // Wed
    logHabit(db, 1, h.id, '2026-06-12') // Fri
    expect(getLogs(db, 1, h.id, '2026-06')).toHaveLength(3)
  })

  it('increments count when logging same day twice', () => {
    const h = createHabit(db, 1, { name: 'Long run', frequency: 'weekly' })
    logHabit(db, 1, h.id, '2026-06-10')
    const second = logHabit(db, 1, h.id, '2026-06-10')
    expect(second.count).toBe(2)
  })

  it('allows logging different weeks', () => {
    const h = createHabit(db, 1, { name: 'Long run', frequency: 'weekly' })
    logHabit(db, 1, h.id, '2026-06-10') // week of Jun 8
    logHabit(db, 1, h.id, '2026-06-17') // week of Jun 15
    expect(getLogs(db, 1, h.id, '2026-06')).toHaveLength(2)
  })
})

describe('unlogHabit — decrement / delete semantics', () => {
  it('decrements count; row survives at count=1 after two logs, one unlog', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10')
    logHabit(db, 1, h.id, '2026-06-10') // count=2
    const result = unlogHabit(db, 1, h.id, '2026-06-10')
    expect(result.count).toBe(1)
    // Row still exists
    expect(getLogs(db, 1, h.id, '2026-06')).toHaveLength(1)
  })

  it('deletes row when count reaches 0', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10') // count=1
    const result = unlogHabit(db, 1, h.id, '2026-06-10')
    expect(result.count).toBe(0)
    expect(getLogs(db, 1, h.id, '2026-06')).toHaveLength(0)
  })

  it('throws when no log exists', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    expect(() => unlogHabit(db, 1, h.id, '2026-06-10')).toThrow('not found')
  })

  it('removes a weekly log by its actual date', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly' })
    logHabit(db, 1, h.id, '2026-06-10')
    unlogHabit(db, 1, h.id, '2026-06-10')
    expect(getLogs(db, 1, h.id, '2026-06')).toHaveLength(0)
  })
})

describe('getDayLog', () => {
  it('returns null when no row', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    expect(getDayLog(db, h, '2026-06-10')).toBeNull()
  })

  it('returns {id, count} when row exists', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10')
    const row = getDayLog(db, h, '2026-06-10')
    expect(row).not.toBeNull()
    expect(row!.count).toBe(1)
    expect(typeof row!.id).toBe('number')
  })
})

describe('isLoggedToday — target_count awareness', () => {
  it('returns false when count < target_count', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily', target_count: 3 })
    logHabit(db, 1, h.id, '2026-06-10')
    logHabit(db, 1, h.id, '2026-06-10') // count=2
    expect(isLoggedToday(db, h, '2026-06-10')).toBe(false)
  })

  it('returns true when count >= target_count', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily', target_count: 2 })
    logHabit(db, 1, h.id, '2026-06-10')
    logHabit(db, 1, h.id, '2026-06-10') // count=2
    expect(isLoggedToday(db, h, '2026-06-10')).toBe(true)
  })

  it('returns false when no log for today', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    const today = new Date().toISOString().slice(0, 10)
    expect(isLoggedToday(db, h, today)).toBe(false)
  })

  it('returns true after logging today (target_count=1)', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    const today = new Date().toISOString().slice(0, 10)
    logHabit(db, 1, h.id, today)
    expect(isLoggedToday(db, h, today)).toBe(true)
  })
})

describe('updateLog', () => {
  it('updates notes on an existing log', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10', 'first note')
    const updated = updateLog(db, 1, h.id, '2026-06-10', { notes: 'revised note' })
    expect(updated.notes).toBe('revised note')
  })

  it('updates rating on an existing log', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10')
    const updated = updateLog(db, 1, h.id, '2026-06-10', { rating: 4 })
    expect(updated.rating).toBe(4)
  })

  it('clears rating when set to null', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10', '', 5)
    const updated = updateLog(db, 1, h.id, '2026-06-10', { rating: null })
    expect(updated.rating).toBeNull()
  })

  it('throws 404 when log does not exist', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    expect(() => updateLog(db, 1, h.id, '2026-06-10', { notes: 'x' })).toThrow('not found')
  })

  it('rejects invalid rating', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10')
    expect(() => updateLog(db, 1, h.id, '2026-06-10', { rating: 6 })).toThrow('rating')
  })
})

describe('logHabit — rating', () => {
  it('stores rating when provided', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    const log = logHabit(db, 1, h.id, '2026-06-10', 'felt great', 5)
    expect(log.rating).toBe(5)
  })

  it('stores null rating when not provided', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    const log = logHabit(db, 1, h.id, '2026-06-10')
    expect(log.rating).toBeNull()
  })

  it('rejects rating outside 1-5', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    expect(() => logHabit(db, 1, h.id, '2026-06-10', '', 0)).toThrow('rating')
    expect(() => logHabit(db, 1, h.id, '2026-06-11', '', 6)).toThrow('rating')
  })
})

describe('isWeekComplete', () => {
  it('returns false when no logs this week', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly', target_count: 3 })
    expect(isWeekComplete(db, h, '2026-06-12')).toBe(false)
  })

  it('returns false when logged but below target_count', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly', target_count: 3 })
    logHabit(db, 1, h.id, '2026-06-08')
    logHabit(db, 1, h.id, '2026-06-10')
    expect(isWeekComplete(db, h, '2026-06-12')).toBe(false)
  })

  it('returns true when logs equal target_count', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly', target_count: 3 })
    logHabit(db, 1, h.id, '2026-06-08')
    logHabit(db, 1, h.id, '2026-06-10')
    logHabit(db, 1, h.id, '2026-06-12')
    expect(isWeekComplete(db, h, '2026-06-12')).toBe(true)
  })

  it('returns true for target_count=1 with one log this week', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly' }) // default target_count=1
    logHabit(db, 1, h.id, '2026-06-10')
    expect(isWeekComplete(db, h, '2026-06-12')).toBe(true)
  })

  it('returns false for daily habits', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-12')
    expect(isWeekComplete(db, h, '2026-06-12')).toBe(false)
  })
})
