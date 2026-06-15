/**
 * Acceptance tests — all ACs from the approved story.
 * Uses real in-memory SQLite + supertest. No mocks except OTel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request    from 'supertest'
import express    from 'express'
import Database   from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import { createRouter } from '../../src/routes/index.js'
import type { ModuleContext } from '@mosaic/sdk'

vi.mock('@opentelemetry/api', () => {
  const span = { end: vi.fn(), setAttribute: vi.fn(), setStatus: vi.fn(), recordException: vi.fn() }
  const tracer = { startActiveSpan: vi.fn().mockImplementation((_n: string, fn: (s: unknown) => unknown) => fn(span)) }
  return {
    trace:          { getTracer: () => tracer },
    metrics:        { getMeter: () => ({ createCounter: () => ({ add: vi.fn() }), createHistogram: () => ({ record: vi.fn() }) }) },
    SpanStatusCode: { ERROR: 'ERROR', OK: 'OK' },
  }
})

function makeApp() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.prepare(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)`).run()
  db.prepare(`INSERT INTO users VALUES (1,'a@b.com')`).run()

  const moduleDb = {
    exec: (sql: string) => db.exec(sql),
    prepare: db.prepare.bind(db),
    transaction: (fn: () => unknown) => { const t = db.transaction(fn); return t() },
    raw: db,
  } as any

  migrate(moduleDb)

  const ctxRef: { current: ModuleContext | null } = {
    current: {
      db:        moduleDb,
      ai:        {} as any,
      logger:    { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} } as any,
      store:     {} as any,
      events:    {} as any,
      notify:    {} as any,
      config:    {} as any,
      scheduler: {} as any,
      calendar:  {} as any,
      slug:      'habits',
    }
  }

  const app = express()
  app.use(express.json())
  app.use((req: any, _res: any, next: any) => { req.userId = 1; next() })
  app.use('/api/habits', createRouter(ctxRef))
  return app
}

let app: ReturnType<typeof makeApp>
beforeEach(() => { app = makeApp() })

// AC1 — Create habit
describe('AC1 — create habit', () => {
  it('creates a daily habit with defaults', async () => {
    const res = await request(app).post('/api/habits/habits')
      .send({ name: 'Morning walk' }).expect(201)
    expect(res.body.name).toBe('Morning walk')
    expect(res.body.frequency).toBe('daily')
    expect(res.body.active).toBe(1)
  })

  it('creates a weekly habit', async () => {
    const res = await request(app).post('/api/habits/habits')
      .send({ name: 'Long run', frequency: 'weekly' }).expect(201)
    expect(res.body.frequency).toBe('weekly')
  })

  it('returns 400 when name is missing', async () => {
    await request(app).post('/api/habits/habits').send({}).expect(400)
  })
})

// AC2 — Log completion
describe('AC2 — log completion', () => {
  it('logs a habit for today when no date provided', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Walk' })
    const res = await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({}).expect(201)
    const today = new Date().toISOString().slice(0, 10)
    expect(res.body.log_date).toBe(today)
  })

  it('logs a habit for a specific date', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Walk' })
    const res = await request(app).post(`/api/habits/habits/${habit.id}/logs`)
      .send({ date: '2026-06-10' }).expect(201)
    expect(res.body.log_date).toBe('2026-06-10')
  })

  it('stores the actual date for weekly habits (no normalization)', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits')
      .send({ name: 'Run', frequency: 'weekly' })
    const res = await request(app).post(`/api/habits/habits/${habit.id}/logs`)
      .send({ date: '2026-06-10' }).expect(201) // Wednesday
    expect(res.body.log_date).toBe('2026-06-10')
  })
})

// AC3 — Unlog
describe('AC3 — unlog completion', () => {
  it('removes an existing log', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Walk' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-10' })
    await request(app).delete(`/api/habits/habits/${habit.id}/logs/2026-06-10`).expect(200)
    const res = await request(app).get(`/api/habits/habits/${habit.id}/logs?month=2026-06`)
    expect(res.body).toHaveLength(0)
  })

  it('returns 409 on duplicate log', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Walk' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-10' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-10' }).expect(409)
  })
})

// AC4 — Streak
describe('AC4 — streak', () => {
  it('GET /habits returns streak for each habit', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Walk' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: new Date().toISOString().slice(0, 10) })
    const res = await request(app).get('/api/habits/habits').expect(200)
    expect(res.body[0].streak).toBeGreaterThanOrEqual(1)
  })
})

// AC5 — Log history
describe('AC5 — log history', () => {
  it('returns logs for the requested month', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Walk' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-10' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-11' })
    const res = await request(app).get(`/api/habits/habits/${habit.id}/logs?month=2026-06`).expect(200)
    expect(res.body).toHaveLength(2)
  })
})

// AC6 — Archive
describe('AC6 — archive', () => {
  it('DELETE removes habit from list', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Old' })
    await request(app).delete(`/api/habits/habits/${habit.id}`).expect(200)
    const res = await request(app).get('/api/habits/habits')
    expect(res.body.find((h: any) => h.id === habit.id)).toBeUndefined()
  })

  it('archived habit appears with include_archived=1', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Old' })
    await request(app).delete(`/api/habits/habits/${habit.id}`)
    const res = await request(app).get('/api/habits/habits?include_archived=1')
    expect(res.body.find((h: any) => h.id === habit.id)).toBeDefined()
  })
})

// AC7 — Notification hook (tested via service, route just needs to mount)
describe('AC7 — notification hook surfaces incomplete habits', () => {
  it('GET /habits returns loggedToday=false for unlogged habit', async () => {
    await request(app).post('/api/habits/habits').send({ name: 'Walk' })
    const res = await request(app).get('/api/habits/habits').expect(200)
    expect(res.body[0].loggedToday).toBe(false)
  })

  it('GET /habits returns loggedToday=true after logging today', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Walk' })
    const today = new Date().toISOString().slice(0, 10)
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: today })
    const res = await request(app).get('/api/habits/habits').expect(200)
    expect(res.body[0].loggedToday).toBe(true)
  })
})

// AC8 — Calendar items (tested via route returning correct shape)
describe('AC8 — calendar items route', () => {
  it('GET /calendar returns log entries as items', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Walk' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-10' })
    const res = await request(app).get('/api/habits/calendar?year=2026&month=6').expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].type).toBe('habit')
    expect(res.body[0].date).toBe('2026-06-10')
  })
})

// AC9 / AC10 — Report routes
describe('AC9 — weekly report route', () => {
  it('GET /reports/weekly returns habits logged in window', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Walk' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-10' })
    const res = await request(app).get('/api/habits/reports/weekly?start=2026-06-08&end=2026-06-14').expect(200)
    expect(res.body.length).toBeGreaterThanOrEqual(1)
  })
})

describe('AC10 — summary report route', () => {
  it('returns active habits count', async () => {
    await request(app).post('/api/habits/habits').send({ name: 'Walk' })
    const res = await request(app).get('/api/habits/reports/summary').expect(200)
    expect(res.body['Active habits']).toBe(1)
  })
})

// AC11 — Frontend entry (just check it serves a JS file)
describe('AC11 — frontend', () => {
  it('GET /ui.js returns javascript', async () => {
    const res = await request(app).get('/api/habits/ui.js').expect(200)
    expect(res.headers['content-type']).toMatch(/javascript/)
  })
})
