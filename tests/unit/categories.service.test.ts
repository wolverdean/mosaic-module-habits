import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/migrate.js'
import { createHabit, getHabit } from '../../src/services/habits.service.js'
import {
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../../src/services/categories.service.js'

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

describe('createCategory', () => {
  it('returns persisted row', () => {
    const cat = createCategory(db, 1, 'Health', '#ff0000')
    expect(cat.id).toBeGreaterThan(0)
    expect(cat.name).toBe('Health')
    expect(cat.color).toBe('#ff0000')
    expect(cat.user_id).toBe(1)
    expect(cat.sort_order).toBe(0)
    expect(typeof cat.created_at).toBe('string')
    expect(typeof cat.updated_at).toBe('string')
  })

  it('rejects duplicate name for same user', () => {
    createCategory(db, 1, 'Health')
    expect(() => createCategory(db, 1, 'Health')).toThrow()
  })

  it('allows same name for different users', () => {
    createCategory(db, 1, 'Health')
    const cat2 = createCategory(db, 2, 'Health')
    expect(cat2.name).toBe('Health')
    expect(cat2.user_id).toBe(2)
  })
})

describe('listCategories', () => {
  it('returns categories for user ordered by sort_order', () => {
    createCategory(db, 1, 'Fitness')
    createCategory(db, 1, 'Mindfulness')
    createCategory(db, 2, 'Other') // different user
    const list = listCategories(db, 1)
    expect(list).toHaveLength(2)
    expect(list.every(c => c.user_id === 1)).toBe(true)
  })
})

describe('getCategoryById', () => {
  it('returns category for correct user', () => {
    const cat = createCategory(db, 1, 'Health')
    const found = getCategoryById(db, 1, cat.id)
    expect(found).not.toBeNull()
    expect(found!.name).toBe('Health')
  })

  it('returns null for wrong user', () => {
    const cat = createCategory(db, 1, 'Health')
    expect(getCategoryById(db, 2, cat.id)).toBeNull()
  })
})

describe('updateCategory', () => {
  it('changes name and updated_at', async () => {
    const cat = createCategory(db, 1, 'Old')
    // Small delay to ensure updated_at will differ from created_at
    await new Promise(r => setTimeout(r, 10))
    const updated = updateCategory(db, 1, cat.id, { name: 'New' })
    expect(updated).toBeDefined()
    expect(updated!.name).toBe('New')
  })

  it('changes sort_order', () => {
    const cat = createCategory(db, 1, 'Health')
    const updated = updateCategory(db, 1, cat.id, { sort_order: 5 })
    expect(updated!.sort_order).toBe(5)
  })

  it('returns undefined for wrong user', () => {
    const cat = createCategory(db, 1, 'Health')
    expect(updateCategory(db, 2, cat.id, { name: 'X' })).toBeUndefined()
  })
})

describe('deleteCategory', () => {
  it('returns true and removes the row', () => {
    const cat = createCategory(db, 1, 'Health')
    const deleted = deleteCategory(db, 1, cat.id)
    expect(deleted).toBe(true)
    expect(getCategoryById(db, 1, cat.id)).toBeNull()
  })

  it('NULLs category_id on associated habits', () => {
    const cat = createCategory(db, 1, 'Health')
    const h = createHabit(db, 1, { name: 'Walk', category_id: cat.id })
    deleteCategory(db, 1, cat.id)
    const updated = getHabit(db, 1, h.id)
    expect(updated?.category_id).toBeNull()
  })

  it('returns false if not found', () => {
    expect(deleteCategory(db, 1, 9999)).toBe(false)
  })
})
