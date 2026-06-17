import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import { createHabit } from '../../src/services/habits.service.js'
import { logHabit } from '../../src/services/logs.service.js'
import { getStreak, getLongestStreak, getCompletionRate30d } from '../../src/services/streak.service.js'

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

  it('days where count < target_count do not count toward streak', () => {
    // target=2, only log once on Jun 10 (count=1) — should not count
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily', target_count: 2 })
    logHabit(db, 1, h.id, '2026-06-10') // count=1, below target
    logHabit(db, 1, h.id, '2026-06-11') // count=1, below target
    logHabit(db, 1, h.id, '2026-06-12') // count=1, below target
    // None meet target=2, so streak=0
    expect(getStreak(db, h, '2026-06-12')).toBe(0)
  })

  it('streak counts days where count >= target_count', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily', target_count: 2 })
    // Log twice on Jun 11 and Jun 12
    logHabit(db, 1, h.id, '2026-06-11')
    logHabit(db, 1, h.id, '2026-06-11') // count=2
    logHabit(db, 1, h.id, '2026-06-12')
    logHabit(db, 1, h.id, '2026-06-12') // count=2
    expect(getStreak(db, h, '2026-06-12')).toBe(2)
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

describe('getLongestStreak — daily', () => {
  it('returns 0 when no logs', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    expect(getLongestStreak(db, h)).toBe(0)
  })

  it('returns 1 for a single log', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10')
    expect(getLongestStreak(db, h)).toBe(1)
  })

  it('returns the longest run, not the current one', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    // old run: 3 days
    logHabit(db, 1, h.id, '2026-05-01')
    logHabit(db, 1, h.id, '2026-05-02')
    logHabit(db, 1, h.id, '2026-05-03')
    // gap
    // current run: 2 days
    logHabit(db, 1, h.id, '2026-06-11')
    logHabit(db, 1, h.id, '2026-06-12')
    expect(getLongestStreak(db, h)).toBe(3)
  })

  it('returns the length when all days are consecutive', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-10')
    logHabit(db, 1, h.id, '2026-06-11')
    logHabit(db, 1, h.id, '2026-06-12')
    expect(getLongestStreak(db, h)).toBe(3)
  })

  it('same target-count awareness: days below target do not count', () => {
    // target=2; log once per day — no complete days → longest=0
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily', target_count: 2 })
    logHabit(db, 1, h.id, '2026-06-10')
    logHabit(db, 1, h.id, '2026-06-11')
    logHabit(db, 1, h.id, '2026-06-12')
    expect(getLongestStreak(db, h)).toBe(0)
  })
})

describe('getStreak — weekly with target_count > 1', () => {
  it('returns 0 when completions in current week are below target', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly', target_count: 3 })
    logHabit(db, 1, h.id, '2026-06-08')
    logHabit(db, 1, h.id, '2026-06-10')
    expect(getStreak(db, h, '2026-06-12')).toBe(0)
  })

  it('counts the week when completions meet target', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly', target_count: 3 })
    logHabit(db, 1, h.id, '2026-06-08')
    logHabit(db, 1, h.id, '2026-06-10')
    logHabit(db, 1, h.id, '2026-06-12')
    expect(getStreak(db, h, '2026-06-12')).toBe(1)
  })

  it('builds a 2-week streak when both weeks meet target', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly', target_count: 2 })
    // week of Jun 1
    logHabit(db, 1, h.id, '2026-06-01')
    logHabit(db, 1, h.id, '2026-06-03')
    // week of Jun 8
    logHabit(db, 1, h.id, '2026-06-08')
    logHabit(db, 1, h.id, '2026-06-10')
    expect(getStreak(db, h, '2026-06-12')).toBe(2)
  })

  it('breaks the streak when a prior week does not meet target', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly', target_count: 3 })
    // week of Jun 1 — only 2 logs (below target of 3)
    logHabit(db, 1, h.id, '2026-06-01')
    logHabit(db, 1, h.id, '2026-06-03')
    // week of Jun 8 — 3 logs
    logHabit(db, 1, h.id, '2026-06-08')
    logHabit(db, 1, h.id, '2026-06-10')
    logHabit(db, 1, h.id, '2026-06-12')
    expect(getStreak(db, h, '2026-06-12')).toBe(1)
  })
})

describe('getLongestStreak — weekly', () => {
  it('returns the longest consecutive week run', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly' })
    // old run: 3 weeks
    logHabit(db, 1, h.id, '2026-05-04') // Mon May 4
    logHabit(db, 1, h.id, '2026-05-11') // Mon May 11
    logHabit(db, 1, h.id, '2026-05-18') // Mon May 18
    // gap: week of May 25
    // current: 1 week
    logHabit(db, 1, h.id, '2026-06-10') // Mon Jun 8
    expect(getLongestStreak(db, h)).toBe(3)
  })
})

describe('getCompletionRate30d', () => {
  it('returns 0 for a habit with no logs', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    expect(getCompletionRate30d(db, h, '2026-06-12')).toBe(0)
  })

  it('returns 100 for a daily habit logged every day for 30 days', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    for (let i = 0; i < 30; i++) {
      const d = new Date('2026-06-12T00:00:00Z')
      d.setUTCDate(d.getUTCDate() - i)
      logHabit(db, 1, h.id, d.toISOString().slice(0, 10))
    }
    expect(getCompletionRate30d(db, h, '2026-06-12')).toBe(100)
  })

  it('returns ~50 for a daily habit logged 15 of 30 days', () => {
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    for (let i = 0; i < 15; i++) {
      const d = new Date('2026-06-12T00:00:00Z')
      d.setUTCDate(d.getUTCDate() - i)
      logHabit(db, 1, h.id, d.toISOString().slice(0, 10))
    }
    expect(getCompletionRate30d(db, h, '2026-06-12')).toBe(50)
  })

  it('caps at 100 for a weekly habit with more logs than expected', () => {
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly' })
    // log all 5 weeks in a 30-day window — expected is 4, so 5/4 > 100%
    logHabit(db, 1, h.id, '2026-05-18') // Mon May 18
    logHabit(db, 1, h.id, '2026-05-25') // Mon May 25
    logHabit(db, 1, h.id, '2026-06-01') // Mon Jun 1
    logHabit(db, 1, h.id, '2026-06-08') // Mon Jun 8
    logHabit(db, 1, h.id, '2026-06-15') // Mon Jun 15 — outside 30d window from Jun 12
    expect(getCompletionRate30d(db, h, '2026-06-12')).toBe(100)
  })

  it('partial days count proportionally (count=2, target=4 → 50%)', () => {
    // target=4, log twice per day for 30 days → each day contributes 2/4 = 50%
    // achieved = 30 * min(2,4) = 60; denominator = 4 * 30 = 120; rate = 50%
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily', target_count: 4 })
    for (let i = 0; i < 30; i++) {
      const d = new Date('2026-06-12T00:00:00Z')
      d.setUTCDate(d.getUTCDate() - i)
      const day = d.toISOString().slice(0, 10)
      logHabit(db, 1, h.id, day)
      logHabit(db, 1, h.id, day) // count=2
    }
    expect(getCompletionRate30d(db, h, '2026-06-12')).toBe(50)
  })

  it('excludes pause-period days from denominator', () => {
    // 30-day window: May 14 – Jun 12. Pause 5 days: Jun 1–5 → denominator = 25.
    // Log 25 days (all non-paused days) → expect 100%
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    const pauseWindows = [{ from: '2026-06-01', to: '2026-06-05' }]
    // Log every day in window except paused period
    const allDays: string[] = []
    for (let i = 0; i < 30; i++) {
      const d = new Date('2026-06-12T00:00:00Z')
      d.setUTCDate(d.getUTCDate() - i)
      allDays.push(d.toISOString().slice(0, 10))
    }
    for (const day of allDays) {
      if (day < '2026-06-01' || day > '2026-06-05') {
        logHabit(db, 1, h.id, day)
      }
    }
    // 25 logs, denominator = 25 → 100%
    expect(getCompletionRate30d(db, h, '2026-06-12', pauseWindows)).toBe(100)
  })
})

describe('dailyStreak — with pause windows', () => {
  it('skips a pause window in the middle of a streak without breaking it', () => {
    // Streak: Jun 6, 7, 8 — then pause Jun 9–10 — then Jun 11, 12
    // Expected streak = 5 (pause window skipped, not counted)
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    logHabit(db, 1, h.id, '2026-06-06')
    logHabit(db, 1, h.id, '2026-06-07')
    logHabit(db, 1, h.id, '2026-06-08')
    logHabit(db, 1, h.id, '2026-06-11')
    logHabit(db, 1, h.id, '2026-06-12')
    const pauseWindows = [{ from: '2026-06-09', to: '2026-06-10' }]
    expect(getStreak(db, h, '2026-06-12', pauseWindows)).toBe(5)
  })

  it('starts from day before paused_since when habit is currently paused', () => {
    // Habit paused on Jun 11. Streak should be computed from Jun 10.
    // Logs: Jun 8, 9, 10 — streak = 3
    const h = createHabit(db, 1, { name: 'Walk', frequency: 'daily' })
    // Manually set paused_since
    db.prepare("UPDATE habits_habits SET paused_since = '2026-06-11' WHERE id = ?").run(h.id)
    const paused = db.prepare('SELECT * FROM habits_habits WHERE id = ?').get(h.id) as any
    logHabit(db, 1, h.id, '2026-06-08')
    logHabit(db, 1, h.id, '2026-06-09')
    logHabit(db, 1, h.id, '2026-06-10')
    expect(getStreak(db, paused, '2026-06-12')).toBe(3)
  })
})

describe('weeklyStreak — with pause windows', () => {
  it('skips a fully-paused week and counts streak across two un-paused weeks as 2', () => {
    // Week of May 25: paused entirely. Logs in week of May 18 and Jun 1 — streak = 2
    const h = createHabit(db, 1, { name: 'Run', frequency: 'weekly' })
    logHabit(db, 1, h.id, '2026-05-18') // week of May 18
    logHabit(db, 1, h.id, '2026-06-01') // week of Jun 1
    // week of May 25 entirely paused
    const pauseWindows = [{ from: '2026-05-25', to: '2026-05-31' }]
    // today is Jun 7 — the week of Jun 1 is last week
    expect(getStreak(db, h, '2026-06-07', pauseWindows)).toBe(2)
  })
})
