import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import { createHabit } from '../../src/services/habits.service.js'
import {
  logHabit,
  unlogHabit,
  getLogs,
  isLoggedToday,
  getMondayOf,
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

describe('logHabit — daily', () => {
  it('logs a daily habit for a given date', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    const log = logHabit(db, 1, h.id, '2026-06-10')
    expect(log.log_date).toBe('2026-06-10')
  })

  it('throws 409 on duplicate log for same date', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10')
    expect(() => logHabit(db, 1, h.id, '2026-06-10')).toThrow('already logged')
  })

  it('allows logging different dates', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10')
    logHabit(db, 1, h.id, '2026-06-11')
    expect(getLogs(db, 1, h.id, '2026-06')).toHaveLength(2)
  })
})

describe('logHabit — weekly', () => {
  it('normalizes log_date to the Monday of the week', () => {
    const h = createHabit(db, 1, { name: 'Long run', frequency: 'weekly' })
    const log = logHabit(db, 1, h.id, '2026-06-10') // Wednesday
    expect(log.log_date).toBe('2026-06-08')          // Monday
  })

  it('throws 409 when same week already logged', () => {
    const h = createHabit(db, 1, { name: 'Long run', frequency: 'weekly' })
    logHabit(db, 1, h.id, '2026-06-10') // Wednesday
    expect(() => logHabit(db, 1, h.id, '2026-06-11')).toThrow('already logged') // Thursday same week
  })

  it('allows logging different weeks', () => {
    const h = createHabit(db, 1, { name: 'Long run', frequency: 'weekly' })
    logHabit(db, 1, h.id, '2026-06-10') // week of Jun 8
    logHabit(db, 1, h.id, '2026-06-17') // week of Jun 15
    expect(getLogs(db, 1, h.id, '2026-06')).toHaveLength(2)
  })
})

describe('unlogHabit', () => {
  it('removes an existing log', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10')
    unlogHabit(db, 1, h.id, '2026-06-10')
    expect(getLogs(db, 1, h.id, '2026-06')).toHaveLength(0)
  })

  it('throws 404 when no log exists', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    expect(() => unlogHabit(db, 1, h.id, '2026-06-10')).toThrow('not found')
  })

  it('normalizes date for weekly habits', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly' })
    logHabit(db, 1, h.id, '2026-06-10')             // stored as 2026-06-08
    unlogHabit(db, 1, h.id, '2026-06-11')            // Wednesday of same week
    expect(getLogs(db, 1, h.id, '2026-06')).toHaveLength(0)
  })
})

describe('isLoggedToday', () => {
  it('returns false when no log for today', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    const today = new Date().toISOString().slice(0, 10)
    expect(isLoggedToday(db, h, today)).toBe(false)
  })

  it('returns true after logging today', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    const today = new Date().toISOString().slice(0, 10)
    logHabit(db, 1, h.id, today)
    expect(isLoggedToday(db, h, today)).toBe(true)
  })
})
