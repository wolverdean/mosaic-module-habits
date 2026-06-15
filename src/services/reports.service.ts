import type { Database }                              from 'better-sqlite3'
import type { NotificationItem, CalendarItem, ReportItem, ReportSummary, DetailedReport } from '@mosaic/sdk'
import type { Habit }                                 from './habits.service.js'
import { getMondayOf, isLoggedToday, isWeekComplete } from './logs.service.js'
import { getStreak, getLongestStreak, getCompletionRate30d } from './streak.service.js'

function pad(n: number): string { return String(n).padStart(2, '0') }

export function getDueHabits(db: Database, userId: number, date: string): NotificationItem[] {
  const habits = db.prepare(
    'SELECT * FROM habits_habits WHERE user_id = ? AND active = 1'
  ).all(userId) as Habit[]

  return habits
    .filter(h => h.frequency === 'weekly' ? !isWeekComplete(db, h, date) : !isLoggedToday(db, h, date))
    .map(h => ({
      id:    `habit:${h.id}`,
      title: `${h.emoji ? h.emoji + ' ' : ''}${h.name}`,
      body:  h.frequency === 'daily' ? 'Not yet done today' : 'Not yet done this week',
      url:   '/habits',
    }))
}

export function getHabitsForCalendar(
  db:     Database,
  userId: number,
  year:   number,
  month:  number,
): CalendarItem[] {
  const mm    = pad(month)
  const start = `${year}-${mm}-01`
  const end   = `${year}-${mm}-31`

  const rows = db.prepare(`
    SELECT l.log_date, h.name, h.emoji, h.id AS habit_id
    FROM habits_logs l
    JOIN habits_habits h ON h.id = l.habit_id
    WHERE l.user_id = ? AND l.log_date >= ? AND l.log_date <= ?
    ORDER BY l.log_date ASC
  `).all(userId, start, end) as { log_date: string; name: string; emoji: string; habit_id: number }[]

  return rows.map(r => ({
    id:    `habit-log:${r.habit_id}:${r.log_date}`,
    title: r.emoji ? `${r.emoji} ${r.name}` : r.name,
    date:  r.log_date,
    type:  'habit' as const,
    url:   '/habits',
  }))
}

export function getWeeklyHabits(
  db:     Database,
  userId: number,
  start:  string,
  end:    string,
): ReportItem[] {
  const rows = db.prepare(`
    SELECT l.log_date, h.name, h.emoji, h.id AS habit_id
    FROM habits_logs l
    JOIN habits_habits h ON h.id = l.habit_id
    WHERE l.user_id = ? AND l.log_date >= ? AND l.log_date <= ?
    ORDER BY l.log_date ASC
  `).all(userId, start, end) as { log_date: string; name: string; emoji: string; habit_id: number }[]

  return rows.map(r => ({
    id:      `habit-log:${r.habit_id}:${r.log_date}`,
    title:   r.emoji ? `${r.emoji} ${r.name}` : r.name,
    dueDate: r.log_date,
    url:     '/habits',
  }))
}

export function getHabitSummary(db: Database, userId: number, today: string): ReportSummary {
  const activeCount = (db.prepare(
    'SELECT COUNT(*) AS n FROM habits_habits WHERE user_id = ? AND active = 1'
  ).get(userId) as { n: number }).n

  const monthStart = today.slice(0, 7) + '-01'
  const completionsThisMonth = (db.prepare(`
    SELECT COUNT(*) AS n FROM habits_logs
    WHERE user_id = ? AND log_date >= ? AND log_date <= ?
  `).get(userId, monthStart, today) as { n: number }).n

  const habits = db.prepare(
    'SELECT * FROM habits_habits WHERE user_id = ? AND active = 1'
  ).all(userId) as Habit[]

  const avgStreak = habits.length === 0 ? 0
    : Math.round(habits.reduce((sum, h) => sum + getStreak(db, h, today), 0) / habits.length)

  const avgRate30d = habits.length === 0 ? 0
    : Math.round(habits.reduce((sum, h) => sum + getCompletionRate30d(db, h, today), 0) / habits.length)

  return {
    'Active habits':          activeCount,
    'Completions this month': completionsThisMonth,
    'Avg streak':             avgStreak,
    'Completion rate 30d':    avgRate30d,
  }
}

export function getDetailedHabitsReport(db: Database, userId: number, start: string, end: string, today: string): DetailedReport {
  const habits = db.prepare(
    'SELECT * FROM habits_habits WHERE user_id = ? AND active = 1 ORDER BY sort_order ASC'
  ).all(userId) as Habit[]

  const completionCounts = db.prepare(`
    SELECT habit_id, COUNT(*) AS count
    FROM habits_logs
    WHERE user_id = ? AND log_date >= ? AND log_date <= ?
    GROUP BY habit_id
  `).all(userId, start, end) as { habit_id: number; count: number }[]
  const countMap = new Map(completionCounts.map(r => [r.habit_id, r.count]))

  const totalCompletions = completionCounts.reduce((s, r) => s + r.count, 0)

  return {
    label: 'Habits',
    sections: [
      {
        type:  'kv',
        title: 'Summary',
        rows:  { 'Active habits': habits.length, 'Completions in period': totalCompletions },
      },
      {
        type:  'table',
        title: 'Per Habit',
        cols:  ['Habit', 'Completions', 'Streak', 'Best streak', 'Rate 30d %'],
        rows:  habits.map(h => [
          `${h.emoji ? h.emoji + ' ' : ''}${h.name}`,
          countMap.get(h.id) ?? 0,
          getStreak(db, h, today),
          getLongestStreak(db, h),
          getCompletionRate30d(db, h, today),
        ]),
      },
      {
        type:  'list',
        title: 'Logged',
        items: getWeeklyHabits(db, userId, start, end),
      },
    ],
  }
}
