import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import { getLatestWeeklyReview, upsertWeeklyReview } from '../../src/services/weekly-review.service.js'

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

describe('getLatestWeeklyReview', () => {
  it('returns null when no reviews', () => {
    expect(getLatestWeeklyReview(db, 1)).toBeNull()
  })

  it('returns the most recent review when multiple exist', () => {
    upsertWeeklyReview(db, 1, '2026-06-01', '2026-06-07', 'Week 1 review')
    upsertWeeklyReview(db, 1, '2026-06-08', '2026-06-14', 'Week 2 review')
    const review = getLatestWeeklyReview(db, 1)
    expect(review).not.toBeNull()
    expect(review!.week_end).toBe('2026-06-14')
    expect(review!.content).toBe('Week 2 review')
  })
})

describe('upsertWeeklyReview', () => {
  it('inserts new row', () => {
    upsertWeeklyReview(db, 1, '2026-06-08', '2026-06-14', 'Great week!')
    const review = getLatestWeeklyReview(db, 1)
    expect(review).not.toBeNull()
    expect(review!.week_start).toBe('2026-06-08')
    expect(review!.week_end).toBe('2026-06-14')
    expect(review!.content).toBe('Great week!')
    expect(typeof review!.generated_at).toBe('string')
  })

  it('replaces existing row for same user+week_end', () => {
    upsertWeeklyReview(db, 1, '2026-06-08', '2026-06-14', 'First version')
    upsertWeeklyReview(db, 1, '2026-06-08', '2026-06-14', 'Updated version')
    const review = getLatestWeeklyReview(db, 1)
    expect(review!.content).toBe('Updated version')
    // Only one row for this week_end
    const count = (db.prepare(
      'SELECT COUNT(*) AS n FROM habits_weekly_reviews WHERE user_id = ? AND week_end = ?'
    ).get(1, '2026-06-14') as { n: number }).n
    expect(count).toBe(1)
  })

  it('does not affect another user review', () => {
    upsertWeeklyReview(db, 1, '2026-06-08', '2026-06-14', 'User 1 review')
    upsertWeeklyReview(db, 2, '2026-06-08', '2026-06-14', 'User 2 review')
    expect(getLatestWeeklyReview(db, 1)!.content).toBe('User 1 review')
    expect(getLatestWeeklyReview(db, 2)!.content).toBe('User 2 review')
  })
})
