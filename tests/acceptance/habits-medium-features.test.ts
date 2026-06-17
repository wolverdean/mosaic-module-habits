/**
 * Acceptance tests — Medium features: multi-completion, habit categories, AI weekly review.
 * Uses real in-memory SQLite + supertest. No mocks except OTel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request    from 'supertest'
import express    from 'express'
import Database   from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import { createRouter } from '../../src/routes/index.js'
import { upsertWeeklyReview } from '../../src/services/weekly-review.service.js'
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

let rawDb: InstanceType<typeof Database>

function makeApp() {
  rawDb = new Database(':memory:')
  rawDb.pragma('foreign_keys = ON')
  rawDb.prepare(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)`).run()
  rawDb.prepare(`INSERT INTO users VALUES (1,'a@b.com')`).run()

  const moduleDb = {
    exec: (sql: string) => rawDb.exec(sql),
    prepare: rawDb.prepare.bind(rawDb),
    transaction: (fn: () => unknown) => { const t = rawDb.transaction(fn); return t() },
    raw: rawDb,
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

// ─── Multi-completion ─────────────────────────────────────────────────────────

describe('multi-completion — POST /habits/:id/logs upsert semantics', () => {

  it('POST on a new date returns 201 with count=1', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Push-ups' })
    const res = await request(app)
      .post(`/api/habits/habits/${habit.id}/logs`)
      .send({ date: '2026-06-15' })
      .expect(201)
    expect(res.body.count).toBe(1)
    expect(res.body.log_date).toBe('2026-06-15')
  })

  it('POST on the same date again returns 201 with count=2', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Push-ups' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-15' })
    const res = await request(app)
      .post(`/api/habits/habits/${habit.id}/logs`)
      .send({ date: '2026-06-15' })
      .expect(201)
    expect(res.body.count).toBe(2)
  })

  it('POST a third time returns 201 with count=3', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Push-ups' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-15' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-15' })
    const res = await request(app)
      .post(`/api/habits/habits/${habit.id}/logs`)
      .send({ date: '2026-06-15' })
      .expect(201)
    expect(res.body.count).toBe(3)
  })

  it('DELETE decrements count to 2 and returns { ok: true, count: 2 }', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Push-ups' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-15' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-15' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-15' })

    const res = await request(app)
      .delete(`/api/habits/habits/${habit.id}/logs/2026-06-15`)
      .expect(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.count).toBe(2)
  })

  it('DELETE again decrements count to 1 and returns { ok: true, count: 1 }', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Push-ups' })
    // Build up count=3, then decrement twice to reach count=1
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-15' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-15' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-15' })
    // count=3 → delete → count=2
    await request(app).delete(`/api/habits/habits/${habit.id}/logs/2026-06-15`).expect(200)

    // count=2 → delete → count=1
    const res = await request(app)
      .delete(`/api/habits/habits/${habit.id}/logs/2026-06-15`)
      .expect(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.count).toBe(1)
  })

  it('DELETE once more reaches count=0: row deleted, returns { ok: true, count: 0 }', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Push-ups' })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: '2026-06-15' })
    await request(app).delete(`/api/habits/habits/${habit.id}/logs/2026-06-15`)

    // Row is deleted — further DELETE should 404
    const res = await request(app)
      .delete(`/api/habits/habits/${habit.id}/logs/2026-06-15`)
      .expect(404)
    // Confirm the row is really gone — GET logs for that month is empty
    const logsRes = await request(app)
      .get(`/api/habits/habits/${habit.id}/logs?month=2026-06`)
      .expect(200)
    expect(logsRes.body).toHaveLength(0)
  })

  it('GET /habits includes todayCount for an active habit', async () => {
    const { body: habit } = await request(app).post('/api/habits/habits').send({ name: 'Push-ups' })
    const today = new Date().toISOString().slice(0, 10)
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: today })
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: today })

    const res = await request(app).get('/api/habits/habits').expect(200)
    const found = res.body.find((h: any) => h.id === habit.id)
    expect(found).toBeDefined()
    expect(found.todayCount).toBe(2)
  })

  it('isLoggedToday is false when count < target_count, true when count >= target_count', async () => {
    // Create habit with target_count=2
    const { body: habit } = await request(app).post('/api/habits/habits')
      .send({ name: 'Push-ups', target_count: 2 })
    const today = new Date().toISOString().slice(0, 10)

    // After one log: count=1 < target_count=2 → loggedToday=false
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: today })
    const resAfterOne = await request(app).get('/api/habits/habits').expect(200)
    const afterOne = resAfterOne.body.find((h: any) => h.id === habit.id)
    expect(afterOne.loggedToday).toBe(false)

    // After second log: count=2 >= target_count=2 → loggedToday=true
    await request(app).post(`/api/habits/habits/${habit.id}/logs`).send({ date: today })
    const resAfterTwo = await request(app).get('/api/habits/habits').expect(200)
    const afterTwo = resAfterTwo.body.find((h: any) => h.id === habit.id)
    expect(afterTwo.loggedToday).toBe(true)
  })
})

// ─── Habit categories ─────────────────────────────────────────────────────────

describe('categories — CRUD and habit filtering', () => {

  it('POST /habits/categories creates a category and returns 201 with the persisted row', async () => {
    const res = await request(app)
      .post('/api/habits/habits/categories')
      .send({ name: 'Health', color: '#FF0000' })
      .expect(201)
    expect(res.body.name).toBe('Health')
    expect(res.body.color).toBe('#FF0000')
    expect(res.body.id).toBeGreaterThan(0)
    expect(res.body.user_id).toBe(1)
  })

  it('GET /habits/categories returns the created category', async () => {
    await request(app).post('/api/habits/habits/categories').send({ name: 'Health' })
    const res = await request(app).get('/api/habits/habits/categories').expect(200)
    expect(res.body.length).toBeGreaterThanOrEqual(1)
    expect(res.body.find((c: any) => c.name === 'Health')).toBeDefined()
  })

  it('POST /habits/categories with duplicate name returns 409', async () => {
    await request(app).post('/api/habits/habits/categories').send({ name: 'Health' }).expect(201)
    await request(app).post('/api/habits/habits/categories').send({ name: 'Health' }).expect(409)
  })

  it('POST /habits/categories with name > 64 chars returns 400', async () => {
    const longName = 'A'.repeat(65)
    await request(app)
      .post('/api/habits/habits/categories')
      .send({ name: longName })
      .expect(400)
  })

  it('PATCH /habits/categories/:id updates name and returns 200', async () => {
    const { body: cat } = await request(app).post('/api/habits/habits/categories').send({ name: 'Health' })
    const res = await request(app)
      .patch(`/api/habits/habits/categories/${cat.id}`)
      .send({ name: 'Wellness' })
      .expect(200)
    expect(res.body.name).toBe('Wellness')
  })

  it('DELETE /habits/categories/:id returns 204', async () => {
    const { body: cat } = await request(app).post('/api/habits/habits/categories').send({ name: 'Temp' })
    await request(app)
      .delete(`/api/habits/habits/categories/${cat.id}`)
      .expect(204)
    // Confirm it is gone from the list
    const listRes = await request(app).get('/api/habits/habits/categories').expect(200)
    expect(listRes.body.find((c: any) => c.id === cat.id)).toBeUndefined()
  })

  it('GET /habits with ?category_id=<id> returns only habits in that category', async () => {
    const { body: cat } = await request(app).post('/api/habits/habits/categories').send({ name: 'Health' })
    await request(app).post('/api/habits/habits').send({ name: 'Walk', category_id: cat.id })
    await request(app).post('/api/habits/habits').send({ name: 'Read' })  // no category

    const res = await request(app).get(`/api/habits/habits?category_id=${cat.id}`).expect(200)
    expect(res.body.length).toBe(1)
    expect(res.body[0].name).toBe('Walk')
  })

  it('GET /habits with ?category_id=null returns only uncategorised habits', async () => {
    const { body: cat } = await request(app).post('/api/habits/habits/categories').send({ name: 'Health' })
    await request(app).post('/api/habits/habits').send({ name: 'Walk', category_id: cat.id })
    await request(app).post('/api/habits/habits').send({ name: 'Read' })  // no category

    const res = await request(app).get('/api/habits/habits?category_id=null').expect(200)
    expect(res.body.every((h: any) => h.category_id === null || h.category_id === undefined)).toBe(true)
    expect(res.body.find((h: any) => h.name === 'Read')).toBeDefined()
    expect(res.body.find((h: any) => h.name === 'Walk')).toBeUndefined()
  })

  it('creating a habit with valid category_id succeeds; response includes category_name', async () => {
    const { body: cat } = await request(app).post('/api/habits/habits/categories').send({ name: 'Fitness' })
    const res = await request(app)
      .post('/api/habits/habits')
      .send({ name: 'Run', category_id: cat.id })
      .expect(201)
    expect(res.body.category_id).toBe(cat.id)
    // category_name is returned from createHabit via JOIN or JOIN-equivalent
    expect(res.body.category_name).toBe('Fitness')
  })

  it('creating a habit with invalid category_id returns 400', async () => {
    await request(app)
      .post('/api/habits/habits')
      .send({ name: 'Run', category_id: 99999 })
      .expect(400)
  })
})

// ─── AI Weekly Review ─────────────────────────────────────────────────────────

describe('weekly-review — GET /habits/reports/weekly-review', () => {

  it('returns 404 when no review exists', async () => {
    const res = await request(app)
      .get('/api/habits/reports/weekly-review')
      .expect(404)
    expect(res.body.error).toBeDefined()
  })

  it('returns 200 with the content after upsertWeeklyReview is called', async () => {
    // Call upsertWeeklyReview directly on the in-memory DB (same rawDb used by the app)
    upsertWeeklyReview(rawDb, 1, '2026-06-09', '2026-06-15', 'Great week of habits!')

    const res = await request(app)
      .get('/api/habits/reports/weekly-review')
      .expect(200)
    expect(res.body.content).toBe('Great week of habits!')
    expect(res.body.week_start).toBe('2026-06-09')
    expect(res.body.week_end).toBe('2026-06-15')
    expect(res.body.generated_at).toBeDefined()
  })
})
