import { Router }                             from 'express'
import { trace, metrics, SpanStatusCode }     from '@opentelemetry/api'
import type { ModuleContext }                  from '@mosaic/sdk'
import fs                                     from 'node:fs'
import path                                   from 'node:path'
import {
  listHabits, getHabit, createHabit, updateHabit, archiveHabit,
} from '../services/habits.service.js'
import { logHabit, unlogHabit, getLogs, updateLog, isWeekComplete } from '../services/logs.service.js'
import { getStreak, getLongestStreak, getCompletionRate30d } from '../services/streak.service.js'
import { isLoggedToday }                       from '../services/logs.service.js'
import {
  getHabitsForCalendar, getWeeklyHabits, getHabitSummary,
} from '../services/reports.service.js'

// ─── OTel ─────────────────────────────────────────────────────────────────────

const tracer      = trace.getTracer('habits')
const meter       = metrics.getMeter('habits')
const reqCounter  = meter.createCounter('habits.requests_total',    { description: 'Habit route requests' })
const reqDuration = meter.createHistogram('habits.request_duration_ms', { unit: 'ms' })
const logCounter  = meter.createCounter('habits.logs_total',        { description: 'Habit completions logged' })

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

  // ── Habits CRUD ────────────────────────────────────────────────────────────

  router.get('/habits', (req, res) => {
    track('habits.list', () => {
      const includeArchived = req.query.include_archived === '1'
      const today = new Date().toISOString().slice(0, 10)
      const habits = listHabits(db(), req.userId, { includeArchived })
      res.json(habits.map(h => ({
        ...h,
        streak:            getStreak(db(), h, today),
        longestStreak:     getLongestStreak(db(), h),
        completionRate30d: getCompletionRate30d(db(), h, today),
        loggedToday:       isLoggedToday(db(), h, today),
        weekComplete:      h.frequency === 'weekly' ? isWeekComplete(db(), h, today) : undefined,
        todayDate:         today,
      })))
    })
  })

  router.post('/habits', (req, res) => {
    track('habits.create', () => {
      const { name, frequency, target_count, description, color, emoji } = req.body
      if (!name || !String(name).trim()) {
        res.status(400).json({ error: 'name is required' }); return
      }
      if (frequency && !['daily', 'weekly'].includes(frequency)) {
        res.status(400).json({ error: 'frequency must be daily or weekly' }); return
      }
      if (target_count !== undefined && (!Number.isInteger(target_count) || target_count < 1)) {
        res.status(400).json({ error: 'target_count must be a positive integer' }); return
      }
      const habit = createHabit(db(), req.userId, { name, frequency, target_count, description, color, emoji })
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
      res.json({
        ...habit,
        streak:            getStreak(db(), habit, today),
        longestStreak:     getLongestStreak(db(), habit),
        completionRate30d: getCompletionRate30d(db(), habit, today),
        loggedToday:       isLoggedToday(db(), habit, today),
        weekComplete:      habit.frequency === 'weekly' ? isWeekComplete(db(), habit, today) : undefined,
        recentLogs:        logs.map(l => l.log_date),
      })
    })
  })

  router.put('/habits/:id', (req, res) => {
    track('habits.update', () => {
      const { name, description, color, emoji, active, sort_order, target_count } = req.body
      if (target_count !== undefined && (!Number.isInteger(target_count) || target_count < 1)) {
        res.status(400).json({ error: 'target_count must be a positive integer' }); return
      }
      const updated = updateHabit(db(), req.userId, Number(req.params.id), {
        name, description, color, emoji, active, sort_order, target_count,
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
      try {
        const log = logHabit(db(), req.userId, habit.id, date, notes, rating)
        logCounter.add(1, { frequency: habit.frequency })
        res.status(201).json(log)
      } catch (err: any) {
        if (err.message?.includes('already logged')) {
          res.status(409).json({ error: err.message }); return
        }
        throw err
      }
    })
  })

  router.delete('/habits/:id/logs/:date', (req, res) => {
    track('logs.delete', () => {
      const habit = getHabit(db(), req.userId, Number(req.params.id))
      if (!habit) { res.status(404).json({ error: 'Not found' }); return }
      try {
        unlogHabit(db(), req.userId, habit.id, req.params.date)
        res.json({ ok: true })
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

  // ── Calendar & reports ─────────────────────────────────────────────────────

  router.get('/calendar', (req, res) => {
    track('calendar', () => {
      const year  = parseInt(req.query.year  as string, 10) || new Date().getFullYear()
      const month = parseInt(req.query.month as string, 10) || (new Date().getMonth() + 1)
      res.json(getHabitsForCalendar(db(), req.userId, year, month))
    })
  })

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
