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
          WHERE user_id = ? AND active = 1
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
  },

  async health(ctx: ModuleContext) {
    ctx.db.raw.prepare('SELECT 1 FROM habits_habits LIMIT 1').get()
    return { status: 'ok' as const }
  },
  healthInterval: 120,
})
