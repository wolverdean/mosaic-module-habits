import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import { createHabit } from '../../src/services/habits.service.js'
import { logHabit } from '../../src/services/logs.service.js'
import { getStreak } from '../../src/services/streak.service.js'

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

describe('getStreak — daily', () => {
  it('returns 0 when no logs exist', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    expect(getStreak(db, h, '2026-06-12')).toBe(0)
  })

  it('returns 1 when only today is logged', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-12')
    expect(getStreak(db, h, '2026-06-12')).toBe(1)
  })

  it('returns 1 when only yesterday is logged (not today)', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-11')
    expect(getStreak(db, h, '2026-06-12')).toBe(1)
  })

  it('returns 3 for 3 consecutive days ending today', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10')
    logHabit(db, 1, h.id, '2026-06-11')
    logHabit(db, 1, h.id, '2026-06-12')
    expect(getStreak(db, h, '2026-06-12')).toBe(3)
  })

  it('stops counting at a gap', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-08') // gap before this
    logHabit(db, 1, h.id, '2026-06-10')
    logHabit(db, 1, h.id, '2026-06-11')
    logHabit(db, 1, h.id, '2026-06-12')
    expect(getStreak(db, h, '2026-06-12')).toBe(3)
  })

  it('returns 0 when the most recent log is older than yesterday', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-09')
    expect(getStreak(db, h, '2026-06-12')).toBe(0)
  })
})

describe('getStreak — weekly', () => {
  it('returns 0 when no logs exist', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly' })
    expect(getStreak(db, h, '2026-06-12')).toBe(0)
  })

  it('returns 1 for a log in the current week', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly' })
    logHabit(db, 1, h.id, '2026-06-10') // week of Jun 8
    expect(getStreak(db, h, '2026-06-12')).toBe(1)
  })

  it('returns 2 for logs in two consecutive weeks ending this week', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly' })
    logHabit(db, 1, h.id, '2026-06-01') // week of Jun 1
    logHabit(db, 1, h.id, '2026-06-10') // week of Jun 8
    expect(getStreak(db, h, '2026-06-12')).toBe(2)
  })

  it('stops counting at a missed week', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly' })
    logHabit(db, 1, h.id, '2026-05-25') // week of May 25
    // gap: week of Jun 1
    logHabit(db, 1, h.id, '2026-06-10') // week of Jun 8
    expect(getStreak(db, h, '2026-06-12')).toBe(1)
  })
})
