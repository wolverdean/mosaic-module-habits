import { defineModule }     from '@mosaic/sdk'
import type { ModuleContext } from '@mosaic/sdk'
import { trace, metrics }    from '@opentelemetry/api'
import { migrate }           from './src/migrate.js'
import { createRouter }      from './src/routes/index.js'
import { notificationHooks } from './src/hooks/notifications.js'
import { reportHooks }       from './src/hooks/reports.js'
import {
  getHabitsForCalendar,
} from './src/services/reports.service.js'
import type { Habit } from './src/services/habits.service.js'
import { isLoggedToday, isWeekComplete } from './src/services/logs.service.js'
import { upsertWeeklyReview } from './src/services/weekly-review.service.js'

const meter   = metrics.getMeter('habits')
const jobRuns = meter.createCounter('habits.jobs.runs_total')
const jobDur  = meter.createHistogram('habits.jobs.duration_ms')

const ctxRef: { current: ModuleContext | null } = { current: null }
const router = createRouter(ctxRef)

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getPreviousSunday(from: Date): string {
  const d = new Date(from)
  d.setUTCHours(0, 0, 0, 0)
  // day 0 = Sunday
  const day = d.getUTCDay()
  // If today is Friday (5), go back to last Sunday (5 days ago)
  const daysBack = day === 0 ? 0 : day
  d.setUTCDate(d.getUTCDate() - daysBack)
  return d.toISOString().slice(0, 10)
}

function getMondayOfDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}

export default defineModule({
  name:    'Habits',
  slug:    'habits',
  version: '1.0.0',
  sdk:     '>=1.0.0',

  migrate,
  router,

  nav: {
    label: 'Habits',
    icon:  'check-circle',
    order: 35,
    badge(ctx: ModuleContext, userId: number) {
      try {
        const n = (ctx.db.raw.prepare(`
          SELECT COUNT(*) AS n FROM habits_habits h
          LEFT JOIN habits_logs hl
            ON hl.habit_id = h.id AND hl.user_id = h.user_id AND hl.log_date = date('now')
          WHERE h.user_id = ?
            AND h.active = 1
            AND (h.paused_since IS NULL OR h.resumed_at IS NOT NULL)
            AND NOT (
              h.frequency = 'daily'
              AND COALESCE(hl.count, 0) >= MAX(1, COALESCE(h.target_count, 1))
            )
            AND NOT (
              h.frequency = 'weekly'
              AND COALESCE(hl.count, 0) >= MAX(1, COALESCE(h.target_count, 1))
            )
        `).get(userId) as { n: number }).n
        return n
      } catch { return 0 }
    },
  },

  frontend: { entry: '/api/habits/ui.js' },

  notifications: notificationHooks,
  reports:       reportHooks,

  calendarItems(ctx: ModuleContext, userId: number, year: number, month: number) {
    return getHabitsForCalendar(ctx.db.raw, userId, year, month)
  },

  async onInit(ctx: ModuleContext) {
    ctxRef.current = ctx
    ctx.logger.info('Habits module initialised')

    ctx.scheduler.add({
      name:     'habit-reminders',
      schedule: '* * * * *',
      fn: async (_jobCtx: ModuleContext) => {
        const t0  = Date.now()
        jobRuns.add(1, { job: 'habit-reminders' })

        const now         = new Date()
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        const today       = now.toISOString().slice(0, 10)
        const db          = ctx.db.raw

        const habits = db.prepare(`
          SELECT * FROM habits_habits
          WHERE active = 1 AND (paused_since IS NULL OR resumed_at IS NOT NULL) AND reminder_time = ?
        `).all(currentTime) as Habit[]

        let sent = 0
        for (const habit of habits) {
          // Skip if already done today
          if (isLoggedToday(db, habit, today)) continue
          if (habit.frequency === 'weekly' && isWeekComplete(db, habit, today)) continue

          // Dedup: use notification_state dismissed_date to record we sent today
          const dedupItemId = `habit-reminder:${habit.id}:${today}`
          const already = db.prepare(
            `SELECT user_id FROM notification_state
             WHERE user_id = ? AND module_slug = 'habits' AND item_id = ? AND dismissed_date = ?`
          ).get(habit.user_id, dedupItemId, today)
          if (already) continue

          await ctx.notify.push(habit.user_id, {
            title: `${habit.emoji ? habit.emoji + ' ' : ''}${habit.name}`,
            body:  'Time to log your habit',
            url:   '/habits',
          })

          db.prepare(
            `INSERT OR IGNORE INTO notification_state (user_id, module_slug, item_id, dismissed_date)
             VALUES (?, 'habits', ?, ?)`
          ).run(habit.user_id, dedupItemId, today)

          sent++
        }

        const dur = Date.now() - t0
        jobDur.record(dur, { job: 'habit-reminders' })
        ctx.logger.info('habit-reminders job ran', { currentTime, checked: habits.length, sent })
      },
    })

    ctx.scheduler.add({
      name:     'habits-weekly-review',
      schedule: '15 3 * * 5',
      fn: async (_jobCtx: ModuleContext) => {
        const log = ctx.logger
        const db  = ctx.db.raw
        const now = new Date()

        const weekEnd   = getPreviousSunday(now)
        const weekStart = getMondayOfDate(weekEnd)

        const users = db.prepare(
          'SELECT DISTINCT user_id FROM habits_habits WHERE active = 1'
        ).all() as { user_id: number }[]

        log.info({ job: 'habits-weekly-review', weekStart, weekEnd, userCount: users.length }, 'job started')

        let generated = 0, skipped = 0, errors = 0

        for (const { user_id } of users) {
          try {
            const completions = db.prepare(`
              SELECT h.name, h.frequency, h.target_count, h.emoji,
                     COALESCE(SUM(hl.count), 0) as actual
              FROM habits_habits h
              LEFT JOIN habits_logs hl
                ON hl.habit_id = h.id
                AND hl.log_date >= ? AND hl.log_date <= ?
              WHERE h.user_id = ? AND h.active = 1
                AND (h.paused_since IS NULL OR h.resumed_at IS NOT NULL)
              GROUP BY h.id
            `).all(weekStart, weekEnd, user_id) as {
              name: string; frequency: string; target_count: number | null; emoji: string; actual: number
            }[]

            const totalCompletions = completions.reduce((s, c) => s + c.actual, 0)
            if (totalCompletions === 0) {
              log.info({ userId: user_id }, 'habits-weekly-review: skipping — zero completions')
              skipped++
              continue
            }

            const lines = completions.map(c => {
              const target = c.frequency === 'daily'
                ? `${Math.max(1, c.target_count ?? 1) * 7} completions target (${Math.max(1, c.target_count ?? 1)}×/day)`
                : `${Math.max(1, c.target_count ?? 1)} sessions target (weekly)`
              return `${c.emoji ? c.emoji + ' ' : ''}${c.name}: completed ${c.actual} (target: ${target})`
            }).join('\n')

            const response = await ctx.ai.client.messages.create({
              model:      ctx.ai.models.efficient,
              max_tokens: 512,
              messages:   [{
                role:    'user',
                content: `You are a personal habit coach. Here is a user's habit performance for the week of ${weekStart} to ${weekEnd}:\n\n${lines}\n\nWrite a short, warm, plain English review (3–5 sentences). Cover what went well, what was partial, and what was missed. Do not invent data. Do not use bullet points or headers.`,
              }],
            })

            const content = (response.content.find((b: any) => b.type === 'text') as any)?.text ?? ''
            upsertWeeklyReview(db, user_id, weekStart, weekEnd, content)
            generated++
            log.info({ userId: user_id, weekEnd }, 'habits-weekly-review: generated')
          } catch (err) {
            errors++
            log.error({ userId: user_id, err }, 'habits-weekly-review: failed')
          }
        }

        log.info({ job: 'habits-weekly-review', generated, skipped, errors }, 'job complete')
      },
    })
  },

  async health(ctx: ModuleContext) {
    ctx.db.raw.prepare('SELECT 1 FROM habits_habits LIMIT 1').get()
    return { status: 'ok' as const }
  },
  healthInterval: 120,
})
