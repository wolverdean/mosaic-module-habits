import { Router }                             from 'express'
import { trace, metrics, SpanStatusCode }     from '@opentelemetry/api'
import type { ModuleContext }                  from '@mosaic/sdk'
import fs                                     from 'node:fs'
import path                                   from 'node:path'
import {
  listHabits, getHabit, createHabit, updateHabit, archiveHabit,
  pauseHabit, resumeHabit,
} from '../services/habits.service.js'
import { logHabit, unlogHabit, getLogs, updateLog, isWeekComplete, getDayLog } from '../services/logs.service.js'
import { getStreak, getLongestStreak, getCompletionRate30d, buildPauseWindows } from '../services/streak.service.js'
import { isLoggedToday }                       from '../services/logs.service.js'
import {
  getHabitsForCalendar, getWeeklyHabits, getHabitSummary, getArchivedHabitStats,
} from '../services/reports.service.js'
import {
  listCategories, getCategoryById, createCategory, updateCategory, deleteCategory,
} from '../services/categories.service.js'
import { getLatestWeeklyReview } from '../services/weekly-review.service.js'

// ─── OTel ─────────────────────────────────────────────────────────────────────

const tracer        = trace.getTracer('habits')
const meter         = metrics.getMeter('habits')
const reqCounter    = meter.createCounter('habits.requests_total',    { description: 'Habit route requests' })
const reqDuration   = meter.createHistogram('habits.request_duration_ms', { unit: 'ms' })
const logCounter    = meter.createCounter('habits.logs_total',        { description: 'Habit completions logged' })
const remindersSent = meter.createCounter('habits.reminders_sent_total', {
  description: 'Per-habit reminder push notifications sent',
})

function track(op: string, fn: () => void): void {
  const t0 = Date.now()
  tracer.startActiveSpan(`habits.${op}`, span => {
    try {
      fn()
      reqCounter.add(1, { op, status: 'ok' })
      span.setStatus({ code: SpanStatusCode.OK })
    } catch (err) {
      reqCounter.add(1, { op, status: 'error' })
      span.setStatus({ code: SpanStatusCode.ERROR })
      span.recordException(err as Error)
      throw err
    } finally {
      reqDuration.record(Date.now() - t0, { op })
      span.end()
    }
  })
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createRouter(ctxRef: { current: ModuleContext | null }): Router {
  const router = Router()

  function db() { return ctxRef.current!.db.raw }

  // ── Categories (must come before /habits/:id to avoid param shadowing) ────

  router.get('/habits/categories', (req, res) => {
    track('categories.list', () => {
      res.json(listCategories(db(), req.userId))
    })
  })

  router.post('/habits/categories', (req, res) => {
    track('categories.create', () => {
      const { name, color } = req.body
      if (!name || !String(name).trim()) {
        res.status(400).json({ error: 'name is required' }); return
      }
      if (String(name).length > 64) {
        res.status(400).json({ error: 'name must be 64 characters or fewer' }); return
      }
      try {
        const cat = createCategory(db(), req.userId, String(name).trim(), color)
        res.status(201).json(cat)
      } catch (err: any) {
        if (err?.message?.includes('UNIQUE')) {
          res.status(409).json({ error: 'A category with that name already exists' }); return
        }
        throw err
      }
    })
  })

  router.patch('/habits/categories/:id', (req, res) => {
    track('categories.update', () => {
      const id = Number(req.params.id)
      const { name, color, sort_order } = req.body
      if (name !== undefined && String(name).length > 64) {
        res.status(400).json({ error: 'name must be 64 characters or fewer' }); return
      }
      try {
        const updated = updateCategory(db(), req.userId, id, { name, color, sort_order })
        if (!updated) { res.status(404).json({ error: 'Not found' }); return }
        res.json(updated)
      } catch (err: any) {
        if (err?.message?.includes('UNIQUE')) {
          res.status(409).json({ error: 'A category with that name already exists' }); return
        }
        throw err
      }
    })
  })

  router.delete('/habits/categories/:id', (req, res) => {
    track('categories.delete', () => {
      const deleted = deleteCategory(db(), req.userId, Number(req.params.id))
      if (!deleted) { res.status(404).json({ error: 'Not found' }); return }
      res.status(204).end()
    })
  })

  // ── Reports (must come before /habits/:id to avoid param shadowing) ────────

  router.get('/reports/weekly', (req, res) => {
    track('reports.weekly', () => {
      const { start, end } = req.query as { start: string; end: string }
      if (!start || !end) { res.status(400).json({ error: 'start and end required' }); return }
      res.json(getWeeklyHabits(db(), req.userId, start, end))
    })
  })

  router.get('/reports/summary', (req, res) => {
    track('reports.summary', () => {
      const today = new Date().toISOString().slice(0, 10)
      res.json(getHabitSummary(db(), req.userId, today))
    })
  })

  router.get('/reports/weekly-review', (req, res) => {
    track('reports.weekly-review', () => {
      const review = getLatestWeeklyReview(db(), req.userId)
      if (!review) { res.status(404).json({ error: 'No weekly review available yet' }); return }
      res.json(review)
    })
  })

  // ── Habits CRUD ────────────────────────────────────────────────────────────

  router.get('/habits', (req, res) => {
    track('habits.list', () => {
      const includeArchived = req.query.include_archived === '1'
      const today = new Date().toISOString().slice(0, 10)

      // category_id filter: 'null' string → 'uncategorised', number string → number, absent → undefined
      const catParam = req.query.category_id as string | undefined
      const categoryId = catParam === 'null' ? 'uncategorised' as const
        : catParam ? Number(catParam) : undefined

      const habits = listHabits(db(), req.userId, { includeArchived, categoryId })
      res.json(habits.map(h => {
        const pw = buildPauseWindows(h, today)
        const dayLog = getDayLog(db(), h, today)
        const base = {
          ...h,
          isPaused:          !!h.paused_since && !h.resumed_at,
          streak:            getStreak(db(), h, today, pw),
          longestStreak:     getLongestStreak(db(), h),
          completionRate30d: getCompletionRate30d(db(), h, today, pw),
          loggedToday:       isLoggedToday(db(), h, today),
          weekComplete:      h.frequency === 'weekly' ? isWeekComplete(db(), h, today) : undefined,
          todayDate:         today,
          todayCount:        dayLog?.count ?? 0,
        }
        if (h.active === 0) {
          return { ...base, ...getArchivedHabitStats(db(), h) }
        }
        return base
      }))
    })
  })

  router.post('/habits', (req, res) => {
    track('habits.create', () => {
      const { name, frequency, target_count, description, color, emoji, reminder_time, category_id } = req.body
      if (!name || !String(name).trim()) {
        res.status(400).json({ error: 'name is required' }); return
      }
      if (frequency && !['daily', 'weekly'].includes(frequency)) {
        res.status(400).json({ error: 'frequency must be daily or weekly' }); return
      }
      if (target_count !== undefined && (!Number.isInteger(target_count) || target_count < 1)) {
        res.status(400).json({ error: 'target_count must be a positive integer' }); return
      }
      if (reminder_time !== undefined && reminder_time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(reminder_time)) {
        res.status(400).json({ error: 'reminder_time must be in HH:MM format' }); return
      }
      if (category_id !== undefined && category_id !== null) {
        const cat = getCategoryById(db(), req.userId, category_id)
        if (!cat) { res.status(400).json({ error: 'invalid category' }); return }
      }
      const habit = createHabit(db(), req.userId, { name, frequency, target_count, description, color, emoji, reminder_time, category_id })
      res.status(201).json(habit)
    })
  })

  router.get('/habits/:id', (req, res) => {
    track('habits.get', () => {
      const habit = getHabit(db(), req.userId, Number(req.params.id))
      if (!habit) { res.status(404).json({ error: 'Not found' }); return }
      const today = new Date().toISOString().slice(0, 10)
      const logs  = db().prepare(
        'SELECT log_date FROM habits_logs WHERE habit_id = ? ORDER BY log_date DESC LIMIT 30'
      ).all(habit.id) as { log_date: string }[]
      const pw = buildPauseWindows(habit, today)
      const dayLog = getDayLog(db(), habit, today)
      res.json({
        ...habit,
        isPaused:          !!habit.paused_since && !habit.resumed_at,
        streak:            getStreak(db(), habit, today, pw),
        longestStreak:     getLongestStreak(db(), habit),
        completionRate30d: getCompletionRate30d(db(), habit, today, pw),
        loggedToday:       isLoggedToday(db(), habit, today),
        weekComplete:      habit.frequency === 'weekly' ? isWeekComplete(db(), habit, today) : undefined,
        todayCount:        dayLog?.count ?? 0,
        recentLogs:        logs.map(l => l.log_date),
      })
    })
  })

  router.put('/habits/:id', (req, res) => {
    track('habits.update', () => {
      const { name, description, color, emoji, active, sort_order, target_count, reminder_time, category_id } = req.body
      if (target_count !== undefined && (!Number.isInteger(target_count) || target_count < 1)) {
        res.status(400).json({ error: 'target_count must be a positive integer' }); return
      }
      if (reminder_time !== undefined && reminder_time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(reminder_time)) {
        res.status(400).json({ error: 'reminder_time must be in HH:MM format' }); return
      }
      if (category_id !== undefined && category_id !== null) {
        const cat = getCategoryById(db(), req.userId, category_id)
        if (!cat) { res.status(400).json({ error: 'invalid category' }); return }
      }
      const updated = updateHabit(db(), req.userId, Number(req.params.id), {
        name, description, color, emoji, active, sort_order, target_count,
        ...('reminder_time' in req.body ? { reminder_time } : {}),
        ...('category_id'   in req.body ? { category_id  } : {}),
      })
      if (!updated) { res.status(404).json({ error: 'Not found' }); return }
      res.json(updated)
    })
  })

  router.delete('/habits/:id', (req, res) => {
    track('habits.archive', () => {
      const habit = getHabit(db(), req.userId, Number(req.params.id))
      if (!habit) { res.status(404).json({ error: 'Not found' }); return }
      archiveHabit(db(), req.userId, Number(req.params.id))
      res.json({ ok: true })
    })
  })

  // ── Pause / Resume / Test-reminder ─────────────────────────────────────────

  router.post('/habits/:id/pause', (req, res) => {
    track('habits.pause', () => {
      const id    = Number(req.params.id)
      const habit = getHabit(db(), req.userId, id)
      if (!habit) { res.status(404).json({ error: 'Not found' }); return }
      if (habit.paused_since !== null && habit.resumed_at === null) {
        res.status(409).json({ error: 'Habit is already paused' }); return
      }
      const today   = new Date().toISOString().slice(0, 10)
      const updated = pauseHabit(db(), req.userId, id, today)
      if (!updated) { res.status(409).json({ error: 'Habit is already paused' }); return }
      res.json(updated)
    })
  })

  router.post('/habits/:id/resume', (req, res) => {
    track('habits.resume', () => {
      const id    = Number(req.params.id)
      const habit = getHabit(db(), req.userId, id)
      if (!habit) { res.status(404).json({ error: 'Not found' }); return }
      if (habit.paused_since === null || habit.resumed_at !== null) {
        res.status(409).json({ error: 'Habit is not paused' }); return
      }
      const today   = new Date().toISOString().slice(0, 10)
      const updated = resumeHabit(db(), req.userId, id, today)
      if (!updated) { res.status(409).json({ error: 'Habit is not paused' }); return }
      // Normalize API response: paused_since=null signals "not currently paused"
      res.json({ ...updated, isPaused: false, paused_since: null })
    })
  })

  router.post('/habits/:id/test-reminder', async (req, res) => {
    const id    = Number(req.params.id)
    const habit = getHabit(db(), req.userId, id)
    if (!habit) { res.status(404).json({ error: 'Not found' }); return }
    if (!habit.reminder_time) { res.status(400).json({ error: 'No reminder time configured' }); return }

    await tracer.startActiveSpan('habits.test_reminder', async span => {
      const t0 = Date.now()
      try {
        await ctxRef.current!.notify.push(req.userId, {
          title: `${habit.emoji ? habit.emoji + ' ' : ''}${habit.name}`,
          body:  'Test reminder: Time to log your habit',
          url:   '/habits',
        })
        remindersSent.add(1, { type: 'test' })
        reqCounter.add(1, { op: 'habits.test_reminder', status: 'ok' })
        span.setStatus({ code: SpanStatusCode.OK })
        res.json({ ok: true })
      } catch (err) {
        reqCounter.add(1, { op: 'habits.test_reminder', status: 'error' })
        span.setStatus({ code: SpanStatusCode.ERROR })
        span.recordException(err as Error)
        res.status(500).json({ error: 'Failed to send notification' })
      } finally {
        reqDuration.record(Date.now() - t0, { op: 'habits.test_reminder' })
        span.end()
      }
    })
  })

  // ── Logs ───────────────────────────────────────────────────────────────────

  router.get('/habits/:id/logs', (req, res) => {
    track('logs.list', () => {
      const habit = getHabit(db(), req.userId, Number(req.params.id))
      if (!habit) { res.status(404).json({ error: 'Not found' }); return }
      const month = (req.query.month as string) || new Date().toISOString().slice(0, 7)
      res.json(getLogs(db(), req.userId, habit.id, month))
    })
  })

  router.post('/habits/:id/logs', (req, res) => {
    track('logs.create', () => {
      const habit = getHabit(db(), req.userId, Number(req.params.id))
      if (!habit) { res.status(404).json({ error: 'Not found' }); return }
      const date   = (req.body.date as string) || new Date().toISOString().slice(0, 10)
      const notes  = (req.body.notes as string) || ''
      const rating = req.body.rating !== undefined ? Number(req.body.rating) : undefined
      if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
        res.status(400).json({ error: 'rating must be an integer between 1 and 5' }); return
      }
      const log = logHabit(db(), req.userId, habit.id, date, notes, rating)
      logCounter.add(1, { frequency: habit.frequency })
      res.status(201).json(log)
    })
  })

  router.delete('/habits/:id/logs/:date', (req, res) => {
    track('logs.delete', () => {
      const habit = getHabit(db(), req.userId, Number(req.params.id))
      if (!habit) { res.status(404).json({ error: 'Not found' }); return }
      try {
        const result = unlogHabit(db(), req.userId, habit.id, req.params.date)
        res.json({ ok: true, count: result.count })
      } catch (err: any) {
        if (err.message?.includes('not found')) {
          res.status(404).json({ error: err.message }); return
        }
        throw err
      }
    })
  })

  router.patch('/habits/:id/logs/:date', (req, res) => {
    track('logs.update', () => {
      const habit = getHabit(db(), req.userId, Number(req.params.id))
      if (!habit) { res.status(404).json({ error: 'Not found' }); return }
      const { notes, rating } = req.body
      if (rating !== undefined && rating !== null && (!Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5)) {
        res.status(400).json({ error: 'rating must be an integer between 1 and 5' }); return
      }
      try {
        const log = updateLog(db(), req.userId, habit.id, req.params.date, {
          notes,
          rating: rating !== undefined ? (rating === null ? null : Number(rating)) : undefined,
        })
        res.json(log)
      } catch (err: any) {
        if (err.message?.includes('not found')) {
          res.status(404).json({ error: err.message }); return
        }
        throw err
      }
    })
  })

  // ── Calendar ───────────────────────────────────────────────────────────────

  router.get('/calendar', (req, res) => {
    track('calendar', () => {
      const year  = parseInt(req.query.year  as string, 10) || new Date().getFullYear()
      const month = parseInt(req.query.month as string, 10) || (new Date().getMonth() + 1)
      res.json(getHabitsForCalendar(db(), req.userId, year, month))
    })
  })

  // ── Frontend ───────────────────────────────────────────────────────────────

  router.get('/ui.js', (_req, res) => {
    const uiPath = path.resolve(__dirname, '../../public/ui.js')
    res.setHeader('Content-Type', 'application/javascript')
    res.setHeader('Cache-Control', 'no-cache')
    if (fs.existsSync(uiPath)) {
      res.sendFile(uiPath)
    } else {
      res.send('// habits ui not yet built')
    }
  })

  return router
}
