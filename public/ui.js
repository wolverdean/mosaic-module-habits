;(function () {
  'use strict'

  // ─── State ─────────────────────────────────────────────────────────────────

  let habits    = []
  let view      = 'list'     // 'list' | 'detail' | 'form'
  let activeId  = null
  let container = null
  let shell     = null

  // ─── API helpers ───────────────────────────────────────────────────────────

  const api = {
    get:    (p)    => shell.api.get(p),
    post:   (p, b) => shell.api.post(p, b),
    put:    (p, b) => shell.api.put(p, b),
    delete: (p)    => shell.api.delete(p),
  }

  // ─── Colours ───────────────────────────────────────────────────────────────

  const COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#14b8a6']

  // ─── Render helpers ────────────────────────────────────────────────────────

  function streakLabel(n) {
    if (n === 0) return '—'
    return `🔥 ${n}`
  }

  function html(strings, ...vals) {
    return strings.reduce((acc, s, i) => acc + s + (vals[i] !== undefined ? String(vals[i]) : ''), '')
  }

  function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  // ─── Views ─────────────────────────────────────────────────────────────────

  function renderList() {
    if (!habits.length) {
      container.innerHTML = `
        <div style="padding:2rem;text-align:center;color:#94a3b8">
          <p>No habits yet.</p>
          <button id="h-new" style="margin-top:1rem;padding:.5rem 1.2rem;background:#6366f1;color:#fff;border:none;border-radius:6px;cursor:pointer">
            + New habit
          </button>
        </div>`
      container.querySelector('#h-new').onclick = () => showForm(null)
      return
    }

    const cards = habits.map(h => `
      <div class="h-card" data-id="${h.id}" style="
        display:flex;align-items:center;gap:.75rem;padding:.9rem 1rem;
        background:#1e293b;border-radius:8px;margin-bottom:.5rem;cursor:pointer">
        <button class="h-toggle" data-id="${h.id}" style="
          width:2.2rem;height:2.2rem;border-radius:50%;border:2px solid ${esc(h.color)};
          background:${h.loggedToday ? esc(h.color) : 'transparent'};
          color:#fff;font-size:1rem;cursor:pointer;flex-shrink:0;
          display:flex;align-items:center;justify-content:center">
          ${h.loggedToday ? '✓' : (h.emoji || '')}
        </button>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${esc(h.name)}
          </div>
          <div style="font-size:.75rem;color:#64748b">${h.frequency}</div>
        </div>
        <div style="font-size:.85rem;color:#f59e0b;font-weight:600;flex-shrink:0">${streakLabel(h.streak)}</div>
      </div>`).join('')

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <h2 style="margin:0;color:#f1f5f9">Habits</h2>
        <div style="display:flex;gap:.5rem">
          <button id="h-archived" style="padding:.35rem .8rem;background:#334155;color:#94a3b8;border:none;border-radius:6px;cursor:pointer;font-size:.8rem">
            Archived
          </button>
          <button id="h-new" style="padding:.35rem .8rem;background:#6366f1;color:#fff;border:none;border-radius:6px;cursor:pointer">
            + New
          </button>
        </div>
      </div>
      ${cards}`

    container.querySelectorAll('.h-toggle').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation()
        const id = Number(btn.dataset.id)
        const habit = habits.find(h => h.id === id)
        if (!habit) return
        try {
          if (habit.loggedToday) {
            await api.delete(`/habits/${id}/logs/${habit.todayDate}`)
          } else {
            await api.post(`/habits/${id}/logs`, {})
          }
          await refreshHabits()
          renderList()
        } catch (err) {
          alert(err.message || 'Error')
        }
      }
    })

    container.querySelectorAll('.h-card').forEach(card => {
      card.onclick = (e) => {
        if (e.target.closest('.h-toggle')) return
        showDetail(Number(card.dataset.id))
      }
    })

    container.querySelector('#h-new').onclick = () => showForm(null)
    container.querySelector('#h-archived').onclick = showArchived
  }

  async function showDetail(id) {
    activeId = id
    view = 'detail'
    const [habit, logsRes] = await Promise.all([
      api.get(`/habits/${id}`),
      api.get(`/habits/${id}/logs?month=${new Date().toISOString().slice(0, 7)}`),
    ])

    const logSet = new Set(logsRes.map(l => l.log_date))
    const now = new Date()
    const year = now.getFullYear(), month = now.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const firstDay = (new Date(year, month, 1).getDay() + 6) % 7  // Mon=0

    const cells = []
    for (let i = 0; i < firstDay; i++) cells.push('<div></div>')
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
      const done = logSet.has(dateStr)
      cells.push(`<div style="
        width:2rem;height:2rem;border-radius:50%;line-height:2rem;text-align:center;
        font-size:.8rem;cursor:pointer;
        background:${done ? esc(habit.color) : '#1e293b'};
        color:${done ? '#fff' : '#64748b'}"
        data-date="${dateStr}">${d}</div>`)
    }

    container.innerHTML = `
      <button id="h-back" style="background:none;border:none;color:#6366f1;cursor:pointer;padding:0;margin-bottom:1rem">← Back</button>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem">
        <div>
          <h2 style="margin:0;color:#f1f5f9">${esc(habit.emoji)} ${esc(habit.name)}</h2>
          <div style="color:#64748b;font-size:.85rem">${habit.frequency} · streak ${streakLabel(habit.streak)}</div>
        </div>
        <button id="h-edit" style="padding:.35rem .8rem;background:#334155;color:#94a3b8;border:none;border-radius:6px;cursor:pointer">Edit</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,2rem);gap:.25rem;justify-content:start;margin-bottom:1.5rem">
        ${['M','T','W','T','F','S','S'].map(d => `<div style="text-align:center;font-size:.7rem;color:#64748b">${d}</div>`).join('')}
        ${cells.join('')}
      </div>
      <div style="display:flex;gap:.5rem">
        <button id="h-log-today" style="padding:.5rem 1.2rem;background:${esc(habit.color)};color:#fff;border:none;border-radius:6px;cursor:pointer">
          ${habit.loggedToday ? 'Unlog today' : 'Log today'}
        </button>
        <button id="h-archive" style="padding:.5rem 1rem;background:#334155;color:#ef4444;border:none;border-radius:6px;cursor:pointer">Archive</button>
      </div>`

    container.querySelector('#h-back').onclick = () => { view = 'list'; renderList() }
    container.querySelector('#h-edit').onclick  = () => showForm(habit)
    container.querySelector('#h-archive').onclick = async () => {
      if (!confirm('Archive this habit?')) return
      await api.delete(`/habits/${id}`)
      await refreshHabits()
      view = 'list'; renderList()
    }
    container.querySelector('#h-log-today').onclick = async () => {
      const today = new Date().toISOString().slice(0, 10)
      if (habit.loggedToday) {
        await api.delete(`/habits/${id}/logs/${today}`)
      } else {
        await api.post(`/habits/${id}/logs`, {})
      }
      await refreshHabits()
      showDetail(id)
    }

    container.querySelectorAll('[data-date]').forEach(cell => {
      cell.onclick = async () => {
        const date = cell.dataset.date
        const done = logSet.has(date)
        try {
          if (done) { await api.delete(`/habits/${id}/logs/${date}`) }
          else      { await api.post(`/habits/${id}/logs`, { date }) }
          showDetail(id)
        } catch {}
      }
    })
  }

  function showForm(habit) {
    view = 'form'
    const isEdit = !!habit
    container.innerHTML = `
      <button id="h-back" style="background:none;border:none;color:#6366f1;cursor:pointer;padding:0;margin-bottom:1rem">← Back</button>
      <h2 style="margin:0 0 1.5rem;color:#f1f5f9">${isEdit ? 'Edit' : 'New'} Habit</h2>
      <label style="display:block;margin-bottom:1rem">
        <span style="color:#94a3b8;font-size:.85rem">Name</span>
        <input id="h-name" value="${esc(habit?.name || '')}" style="display:block;width:100%;margin-top:.25rem;padding:.5rem;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#f1f5f9;box-sizing:border-box">
      </label>
      <label style="display:block;margin-bottom:1rem">
        <span style="color:#94a3b8;font-size:.85rem">Emoji</span>
        <input id="h-emoji" value="${esc(habit?.emoji || '')}" maxlength="4" style="display:block;width:5rem;margin-top:.25rem;padding:.5rem;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#f1f5f9">
      </label>
      ${!isEdit ? `
      <fieldset style="border:1px solid #334155;border-radius:6px;padding:.75rem;margin-bottom:1rem">
        <legend style="color:#94a3b8;font-size:.85rem;padding:0 .4rem">Frequency</legend>
        <label style="margin-right:1.5rem;color:#f1f5f9;cursor:pointer">
          <input type="radio" name="freq" value="daily" checked> Daily
        </label>
        <label style="color:#f1f5f9;cursor:pointer">
          <input type="radio" name="freq" value="weekly"> Weekly
        </label>
      </fieldset>` : ''}
      <label style="display:block;margin-bottom:1rem">
        <span style="color:#94a3b8;font-size:.85rem">Description</span>
        <textarea id="h-desc" style="display:block;width:100%;margin-top:.25rem;padding:.5rem;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#f1f5f9;box-sizing:border-box;resize:vertical;min-height:4rem">${esc(habit?.description || '')}</textarea>
      </label>
      <div style="margin-bottom:1.5rem">
        <span style="color:#94a3b8;font-size:.85rem;display:block;margin-bottom:.5rem">Color</span>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          ${COLORS.map(c => `<div class="h-color" data-color="${c}" style="width:1.5rem;height:1.5rem;border-radius:50%;background:${c};cursor:pointer;outline:${(habit?.color||'#6366f1')===c?'3px solid #fff':'none'};outline-offset:2px"></div>`).join('')}
        </div>
      </div>
      <button id="h-save" style="padding:.6rem 1.4rem;background:#6366f1;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:1rem">
        ${isEdit ? 'Save' : 'Create'}
      </button>`

    let selectedColor = habit?.color || '#6366f1'
    container.querySelectorAll('.h-color').forEach(el => {
      el.onclick = () => {
        selectedColor = el.dataset.color
        container.querySelectorAll('.h-color').forEach(e => e.style.outline = 'none')
        el.style.outline = '3px solid #fff'
        el.style.outlineOffset = '2px'
      }
    })

    container.querySelector('#h-back').onclick = () => { view = 'list'; renderList() }
    container.querySelector('#h-save').onclick = async () => {
      const name  = container.querySelector('#h-name').value.trim()
      const emoji = container.querySelector('#h-emoji').value
      const desc  = container.querySelector('#h-desc').value
      const freq  = isEdit ? habit.frequency
        : container.querySelector('input[name="freq"]:checked')?.value || 'daily'
      if (!name) { alert('Name is required'); return }
      try {
        if (isEdit) {
          await api.put(`/habits/${habit.id}`, { name, emoji, description: desc, color: selectedColor })
        } else {
          await api.post('/habits', { name, emoji, description: desc, color: selectedColor, frequency: freq })
        }
        await refreshHabits()
        view = 'list'; renderList()
      } catch (err) {
        alert(err.message || 'Error saving habit')
      }
    }
  }

  async function showArchived() {
    const all = await api.get('/habits?include_archived=1')
    const archived = all.filter(h => !h.active)
    container.innerHTML = `
      <button id="h-back" style="background:none;border:none;color:#6366f1;cursor:pointer;padding:0;margin-bottom:1rem">← Back</button>
      <h2 style="margin:0 0 1rem;color:#f1f5f9">Archived Habits</h2>
      ${archived.length === 0 ? '<p style="color:#64748b">No archived habits.</p>' :
        archived.map(h => `
          <div style="display:flex;align-items:center;gap:.75rem;padding:.75rem;background:#1e293b;border-radius:8px;margin-bottom:.5rem">
            <span style="flex:1;color:#94a3b8">${esc(h.emoji)} ${esc(h.name)}</span>
            <button class="h-restore" data-id="${h.id}" style="padding:.3rem .7rem;background:#334155;color:#10b981;border:none;border-radius:6px;cursor:pointer;font-size:.8rem">Restore</button>
          </div>`).join('')}`

    container.querySelector('#h-back').onclick = () => { view = 'list'; renderList() }
    container.querySelectorAll('.h-restore').forEach(btn => {
      btn.onclick = async () => {
        await api.put(`/habits/${btn.dataset.id}`, { active: 1 })
        await refreshHabits()
        showArchived()
      }
    })
  }

  // ─── Data ──────────────────────────────────────────────────────────────────

  async function refreshHabits() {
    habits = await api.get('/habits')
  }

  // ─── Module registration ───────────────────────────────────────────────────

  window.Mosaic.registerModule({
    slug: 'habits',

    init(s) {
      shell = s
    },

    async onActivate(el) {
      container = el
      container.style.padding = '1rem'
      try {
        await refreshHabits()
        renderList()
      } catch (err) {
        container.innerHTML = `<p style="color:#ef4444">Failed to load habits: ${esc(err.message)}</p>`
      }
    },

    onDeactivate() {
      container = null
    },
  })
})()
