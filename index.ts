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

const meter   = metrics.getMeter('habits')
const jobRuns = meter.createCounter('habits.jobs.runs_total')
const jobDur  = meter.createHistogram('habits.jobs.duration_ms')

const ctxRef: { current: ModuleContext | null } = { current: null }
const router = createRouter(ctxRef)

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
        const today = new Date().toISOString().slice(0, 10)
        const n = (ctx.db.raw.prepare(`
          SELECT COUNT(*) AS n FROM habits_habits
          WHERE user_id = ? AND active = 1 AND (paused_since IS NULL OR resumed_at IS NOT NULL)
            AND id NOT IN (
              SELECT habit_id FROM habits_logs
              WHERE user_id = ? AND log_date = ?
            )
        `).get(userId, userId, today) as { n: number }).n
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
  },

  async health(ctx: ModuleContext) {
    ctx.db.raw.prepare('SELECT 1 FROM habits_habits LIMIT 1').get()
    return { status: 'ok' as const }
  },
  healthInterval: 120,
})
