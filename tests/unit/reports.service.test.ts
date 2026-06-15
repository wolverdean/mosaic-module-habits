import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import { createHabit } from '../../src/services/habits.service.js'
import { logHabit } from '../../src/services/logs.service.js'
import {
  getDueHabits,
  getHabitsForCalendar,
  getWeeklyHabits,
  getHabitSummary,
} from '../../src/services/reports.service.js'
import { archiveHabit } from '../../src/services/habits.service.js'

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

describe('getDueHabits', () => {
  it('returns daily habit not yet logged today', () => {
    createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    const due = getDueHabits(db, 1, '2026-06-12')
    expect(due).toHaveLength(1)
    expect(due[0].title).toBe('Walk')
  })

  it('excludes daily habit already logged today', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-12')
    expect(getDueHabits(db, 1, '2026-06-12')).toHaveLength(0)
  })

  it('returns weekly habit not yet logged this week', () => {
    createHabit(db, 1, { name: 'Run', frequency: 'weekly' })
    expect(getDueHabits(db, 1, '2026-06-12')).toHaveLength(1) // week of Jun 8, no log
  })

  it('excludes weekly habit already logged this week', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly' })
    logHabit(db, 1, h.id, '2026-06-10') // a log this week (week of Jun 8)
    expect(getDueHabits(db, 1, '2026-06-12')).toHaveLength(0)
  })

  it('excludes archived habits', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    archiveHabit(db, 1, h.id)
    expect(getDueHabits(db, 1, '2026-06-12')).toHaveLength(0)
  })
})

describe('getHabitsForCalendar', () => {
  it('returns logs as calendar items for the requested month', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10')
    logHabit(db, 1, h.id, '2026-06-11')
    const items = getHabitsForCalendar(db, 1, 2026, 6)
    expect(items).toHaveLength(2)
    expect(items[0].type).toBe('habit')
    expect(items[0].date).toBe('2026-06-10')
  })

  it('returns nothing for a month with no logs', () => {
    createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    expect(getHabitsForCalendar(db, 1, 2026, 7)).toHaveLength(0)
  })
})

describe('getWeeklyHabits', () => {
  it('returns habits logged in the date window', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10')
    const items = getWeeklyHabits(db, 1, '2026-06-08', '2026-06-14')
    expect(items).toHaveLength(1)
    expect(items[0].title).toContain('Walk')
  })

  it('excludes logs outside the window', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-07') // before window
    expect(getWeeklyHabits(db, 1, '2026-06-08', '2026-06-14')).toHaveLength(0)
  })
})

describe('getHabitSummary', () => {
  it('returns active habit count, completions this month, and avg streak', () => {
    const today = new Date().toISOString().slice(0, 10)
    createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    const h2 = createHabit(db, 1, { name: 'Read', frequency: 'daily' })
    logHabit(db, 1, h2.id, today)
    const summary = getHabitSummary(db, 1, today)
    expect(summary['Active habits']).toBe(2)
    expect(summary['Completions this month']).toBeGreaterThanOrEqual(1)
    expect('Avg streak' in summary).toBe(true)
  })
})
