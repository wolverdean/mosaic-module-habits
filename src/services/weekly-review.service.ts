import type { Database } from 'better-sqlite3'

export interface WeeklyReview {
  week_start:   string
  week_end:     string
  content:      string
  generated_at: string
}

export function getLatestWeeklyReview(db: Database, userId: number): WeeklyReview | null {
  const row = db.prepare(`
    SELECT week_start, week_end, content, generated_at
    FROM habits_weekly_reviews
    WHERE user_id = ?
    ORDER BY week_end DESC
    LIMIT 1
  `).get(userId) as WeeklyReview | undefined
  return row ?? null
}

export function upsertWeeklyReview(
  db:        Database,
  userId:    number,
  weekStart: string,
  weekEnd:   string,
  content:   string,
): void {
  db.prepare(`
    INSERT OR REPLACE INTO habits_weekly_reviews (user_id, week_start, week_end, content)
    VALUES (?, ?, ?, ?)
  `).run(userId, weekStart, weekEnd, content)
}
