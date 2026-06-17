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
    patch:  (p, b) => shell.fetch(`/api/habits${p}`, { method: 'PATCH', body: b }),
  }

  // ─── Colours ───────────────────────────────────────────────────────────────

  const COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#14b8a6']

  // ─── Render helpers ────────────────────────────────────────────────────────

  function streakLabel(n) {
    if (n === 0) return '—'
    return `🔥 ${n}`
  }

  function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  function freqLabel(h) {
    if (h.frequency === 'daily') return 'daily'
    return h.target_count > 1 ? `${h.target_count}× per week` : 'weekly'
  }

  function stars(rating) {
    if (!rating) return ''
    return '★'.repeat(rating) + '☆'.repeat(5 - rating)
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

    const cards = habits.map(h => {
      const done = h.frequency === 'weekly' ? h.weekComplete : h.loggedToday
      const toggleBtn = h.isPaused
        ? `<div style="width:2.2rem;height:2.2rem;border-radius:50%;border:2px solid #475569;background:#475569;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#94a3b8">⏸</div>`
        : `<button class="h-toggle" data-id="${h.id}" style="
            width:2.2rem;height:2.2rem;border-radius:50%;border:2px solid ${esc(h.color)};
            background:${done ? esc(h.color) : 'transparent'};
            color:#fff;font-size:1rem;cursor:pointer;flex-shrink:0;
            display:flex;align-items:center;justify-content:center">
            ${done ? '✓' : (h.emoji || '')}
          </button>`
      return `
      <div class="h-card" data-id="${h.id}" style="
        display:flex;align-items:center;gap:.75rem;padding:.9rem 1rem;
        background:#1e293b;border-radius:8px;margin-bottom:.5rem;cursor:pointer">
        ${toggleBtn}
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${esc(h.name)}
          </div>
          <div style="font-size:.75rem;color:#64748b">${freqLabel(h)}</div>
          ${h.isPaused ? `<span style="display:inline-block;background:#78350f;color:#fbbf24;font-size:.7rem;padding:1px 6px;border-radius:10px;margin-top:2px">Paused</span>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:.85rem;color:#f59e0b;font-weight:600">${streakLabel(h.streak)}</div>
          ${h.completionRate30d != null ? `<div style="font-size:.7rem;color:#64748b">${h.completionRate30d}%</div>` : ''}
        </div>
      </div>`
    }).join('')

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
        const id    = Number(btn.dataset.id)
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

    // Build map date → log for rating display
    const logMap = {}
    logsRes.forEach(l => { logMap[l.log_date] = l })

    // Week progress for weekly habits
    const today    = new Date().toISOString().slice(0, 10)
    const weekLogs = habit.frequency === 'weekly'
      ? logsRes.filter(l => {
          const d = new Date(`${l.log_date}T00:00:00Z`)
          const day = d.getUTCDay()
          const diff = day === 0 ? -6 : 1 - day
          d.setUTCDate(d.getUTCDate() + diff)
          const monday = d.toISOString().slice(0, 10)
          const now = new Date(`${today}T00:00:00Z`)
          const nd = now.getUTCDay()
          now.setUTCDate(now.getUTCDate() - (nd === 0 ? 6 : nd - 1))
          return monday === now.toISOString().slice(0, 10)
        }).length
      : 0

    // Calendar grid
    const now     = new Date()
    const year    = now.getFullYear(), month = now.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const firstDay    = (new Date(year, month, 1).getDay() + 6) % 7  // Mon=0

    const cells = []
    for (let i = 0; i < firstDay; i++) cells.push('<div></div>')
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
      // Paused days: neutral style, not interactive
      const isPausedDay = habit.paused_since && dateStr >= habit.paused_since && dateStr <= today
      if (isPausedDay) {
        cells.push(`<div style="
          width:2rem;height:2rem;border-radius:50%;line-height:2rem;text-align:center;
          font-size:.75rem;position:relative;
          background:#334155;color:#64748b;border:none">${d}</div>`)
        continue
      }
      const log = logMap[dateStr]
      const done = !!log
      // Rating shading: 1-2=50%, 3=75%, 4-5=100% opacity
      const opacity = !done ? 1 : (!log.rating ? 1 : log.rating <= 2 ? 0.45 : log.rating === 3 ? 0.7 : 1)
      cells.push(`<div style="
        width:2rem;height:2rem;border-radius:50%;line-height:2rem;text-align:center;
        font-size:.75rem;cursor:pointer;position:relative;
        background:${done ? esc(habit.color) : '#1e293b'};
        opacity:${done ? opacity : 1};
        color:${done ? '#fff' : '#64748b'};
        border:${done && log.rating ? '2px solid rgba(255,255,255,.4)' : 'none'}"
        data-date="${dateStr}">${done && log.rating ? log.rating : d}</div>`)
    }

    const weekProgressHtml = habit.frequency === 'weekly' ? `
      <div style="margin-bottom:1rem;padding:.6rem .75rem;background:#1e293b;border-radius:6px;display:flex;align-items:center;gap:.75rem">
        <span style="color:#94a3b8;font-size:.85rem">This week</span>
        <div style="display:flex;gap:.3rem">
          ${Array.from({ length: habit.target_count }, (_, i) => `
            <div style="width:.75rem;height:.75rem;border-radius:50%;background:${i < weekLogs ? esc(habit.color) : '#334155'}"></div>
          `).join('')}
        </div>
        <span style="font-size:.85rem;color:${habit.weekComplete ? '#10b981' : '#94a3b8'}">
          ${weekLogs} / ${habit.target_count}${habit.weekComplete ? ' ✓' : ''}
        </span>
      </div>` : ''

    container.innerHTML = `
      <button id="h-back" style="background:none;border:none;color:#6366f1;cursor:pointer;padding:0;margin-bottom:1rem">← Back</button>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.75rem">
        <div>
          <h2 style="margin:0;color:#f1f5f9">${esc(habit.emoji)} ${esc(habit.name)}${habit.isPaused || habit.paused_since ? ` <span style="display:inline-block;background:#78350f;color:#fbbf24;font-size:.7rem;padding:1px 6px;border-radius:10px;vertical-align:middle">Paused</span>` : ''}</h2>
          <div style="color:#64748b;font-size:.85rem">${freqLabel(habit)}</div>
        </div>
        <button id="h-edit" style="padding:.35rem .8rem;background:#334155;color:#94a3b8;border:none;border-radius:6px;cursor:pointer">Edit</button>
      </div>

      <div style="display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap">
        <span style="padding:.3rem .6rem;background:#1e293b;border-radius:6px;font-size:.8rem;color:#f59e0b;font-weight:600">${streakLabel(habit.streak)} streak</span>
        <span style="padding:.3rem .6rem;background:#1e293b;border-radius:6px;font-size:.8rem;color:#94a3b8">⭐ ${habit.longestStreak} best</span>
        <span style="padding:.3rem .6rem;background:#1e293b;border-radius:6px;font-size:.8rem;color:#94a3b8">${habit.completionRate30d}% (30d)</span>
      </div>

      ${weekProgressHtml}

      <div style="display:grid;grid-template-columns:repeat(7,2rem);gap:.25rem;justify-content:start;margin-bottom:1.5rem">
        ${['M','T','W','T','F','S','S'].map(d => `<div style="text-align:center;font-size:.7rem;color:#64748b">${d}</div>`).join('')}
        ${cells.join('')}
      </div>

      <div style="display:flex;gap:.5rem;margin-bottom:1rem">
        ${habit.isPaused || habit.paused_since
          ? `<button disabled style="padding:.5rem 1.2rem;background:${esc(habit.color)};color:#fff;border:none;border-radius:6px;cursor:not-allowed;opacity:0.4">${habit.loggedToday ? 'Unlog today' : 'Log today'}</button>`
          : `<button id="h-log-today" style="padding:.5rem 1.2rem;background:${esc(habit.color)};color:#fff;border:none;border-radius:6px;cursor:pointer">${habit.loggedToday ? 'Unlog today' : 'Log today'}</button>`}
        <button id="h-archive" style="padding:.5rem 1rem;background:#334155;color:#ef4444;border:none;border-radius:6px;cursor:pointer">Archive</button>
      </div>
      <div style="display:flex;gap:.5rem;margin-bottom:1rem">
        ${habit.isPaused || habit.paused_since
          ? `<button id="h-resume-btn" style="padding:.5rem 1rem;background:#334155;color:#10b981;border:none;border-radius:6px;cursor:pointer">&#9654; Resume</button>`
          : `<button id="h-pause-btn" style="padding:.5rem 1rem;background:#334155;color:#fbbf24;border:none;border-radius:6px;cursor:pointer">&#9208; Pause</button>`}
      </div>

      <div id="h-log-panel" style="display:none;background:#1e293b;border-radius:8px;padding:1rem;margin-bottom:1rem">
        <div style="color:#94a3b8;font-size:.8rem;margin-bottom:.5rem" id="h-panel-date"></div>
        <textarea id="h-panel-notes" placeholder="Notes (optional)" style="display:block;width:100%;box-sizing:border-box;padding:.5rem;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#f1f5f9;resize:vertical;min-height:3rem;font-family:inherit;margin-bottom:.6rem"></textarea>
        <div style="margin-bottom:.75rem">
          <span style="color:#94a3b8;font-size:.8rem;display:block;margin-bottom:.3rem">Rating</span>
          <div id="h-stars" style="display:flex;gap:.25rem;font-size:1.4rem;cursor:pointer;color:#64748b">
            ${[1,2,3,4,5].map(n => `<span class="h-star" data-val="${n}">☆</span>`).join('')}
          </div>
        </div>
        <div style="display:flex;gap:.5rem">
          <button id="h-panel-save" style="padding:.4rem 1rem;background:#6366f1;color:#fff;border:none;border-radius:6px;cursor:pointer">Save</button>
          <button id="h-panel-cancel" style="padding:.4rem .8rem;background:#334155;color:#94a3b8;border:none;border-radius:6px;cursor:pointer">Cancel</button>
          <button id="h-panel-delete" style="display:none;padding:.4rem .8rem;background:#334155;color:#ef4444;border:none;border-radius:6px;cursor:pointer;margin-left:auto">Remove log</button>
        </div>
      </div>`

    // ── Log panel state ──
    let panelDate   = null
    let panelRating = null
    let panelMode   = 'create'  // 'create' | 'edit'

    function openPanel(date, existingLog) {
      panelDate   = date
      panelRating = existingLog?.rating ?? null
      panelMode   = existingLog ? 'edit' : 'create'
      const panel = container.querySelector('#h-log-panel')
      container.querySelector('#h-panel-date').textContent = date
      container.querySelector('#h-panel-notes').value = existingLog?.notes ?? ''
      container.querySelector('#h-panel-delete').style.display = existingLog ? 'inline-block' : 'none'
      renderStars(panelRating)
      panel.style.display = 'block'
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }

    function closePanel() {
      container.querySelector('#h-log-panel').style.display = 'none'
      panelDate = null; panelRating = null
    }

    function renderStars(val) {
      container.querySelectorAll('.h-star').forEach(s => {
        s.textContent = Number(s.dataset.val) <= (val || 0) ? '★' : '☆'
        s.style.color  = Number(s.dataset.val) <= (val || 0) ? '#f59e0b' : '#64748b'
      })
    }

    container.querySelectorAll('.h-star').forEach(s => {
      s.onclick = () => {
        const v = Number(s.dataset.val)
        panelRating = panelRating === v ? null : v
        renderStars(panelRating)
      }
    })

    container.querySelector('#h-panel-cancel').onclick = closePanel

    container.querySelector('#h-panel-save').onclick = async () => {
      const notes = container.querySelector('#h-panel-notes').value
      try {
        if (panelMode === 'create') {
          await api.post(`/habits/${id}/logs`, { date: panelDate, notes, rating: panelRating })
        } else {
          await api.patch(`/habits/${id}/logs/${panelDate}`, { notes, rating: panelRating })
        }
        closePanel()
        showDetail(id)
      } catch (err) { alert(err.message || 'Error') }
    }

    container.querySelector('#h-panel-delete').onclick = async () => {
      try {
        await api.delete(`/habits/${id}/logs/${panelDate}`)
        closePanel()
        showDetail(id)
      } catch (err) { alert(err.message || 'Error') }
    }

    // ── Calendar clicks ──
    container.querySelectorAll('[data-date]').forEach(cell => {
      cell.onclick = () => openPanel(cell.dataset.date, logMap[cell.dataset.date] ?? null)
    })

    container.querySelector('#h-back').onclick  = () => { view = 'list'; renderList() }
    container.querySelector('#h-edit').onclick   = () => showForm(habit)
    container.querySelector('#h-archive').onclick = async () => {
      if (!confirm('Archive this habit?')) return
      await api.delete(`/habits/${id}`)
      await refreshHabits()
      view = 'list'; renderList()
    }

    const logTodayBtn = container.querySelector('#h-log-today')
    if (logTodayBtn) {
      logTodayBtn.onclick = () => {
        if (habit.loggedToday) {
          // unlog immediately
          api.delete(`/habits/${id}/logs/${today}`).then(() => { refreshHabits(); showDetail(id) }).catch(e => alert(e.message))
        } else {
          openPanel(today, null)
        }
      }
    }

    const pauseBtn = container.querySelector('#h-pause-btn')
    if (pauseBtn) {
      pauseBtn.onclick = async () => {
        try {
          await api.post(`/habits/${id}/pause`, {})
          showDetail(id)
        } catch (err) { alert(err.message || 'Error pausing habit') }
      }
    }

    const resumeBtn = container.querySelector('#h-resume-btn')
    if (resumeBtn) {
      resumeBtn.onclick = async () => {
        try {
          await api.post(`/habits/${id}/resume`, {})
          showDetail(id)
        } catch (err) { alert(err.message || 'Error resuming habit') }
      }
    }
  }

  function showForm(habit) {
    view = 'form'
    const isEdit    = !!habit
    const isWeekly  = isEdit && habit.frequency === 'weekly'

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
      <div id="h-target-wrap" style="display:${isWeekly ? 'block' : 'none'};margin-bottom:1rem">
        <label>
          <span style="color:#94a3b8;font-size:.85rem">Times per week</span>
          <input id="h-target" type="number" min="1" max="7" value="${isEdit ? (habit.target_count ?? 1) : 1}"
            style="display:block;width:5rem;margin-top:.25rem;padding:.5rem;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#f1f5f9">
        </label>
      </div>
      <div style="margin-bottom:1rem">
        <label style="display:block;font-size:.8rem;color:#94a3b8;margin-bottom:.25rem">Daily reminder (optional)</label>
        <input type="time" id="h-reminder" value="${esc(habit?.reminder_time ?? '')}"
          style="background:#0f172a;color:#f1f5f9;border:1px solid #334155;border-radius:6px;padding:.5rem .75rem;width:100%;box-sizing:border-box">
      </div>
      ${habit && habit.reminder_time ? `
        <button id="h-test-reminder" type="button" style="margin-bottom:1rem;padding:.4rem .9rem;background:#1e293b;color:#94a3b8;border:1px solid #334155;border-radius:6px;cursor:pointer;font-size:.85rem">
          Send test notification
        </button>` : ''}
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

    // Show/hide target_count when frequency radio changes
    if (!isEdit) {
      container.querySelectorAll('input[name="freq"]').forEach(radio => {
        radio.onchange = () => {
          const wrap = container.querySelector('#h-target-wrap')
          if (wrap) wrap.style.display = radio.value === 'weekly' ? 'block' : 'none'
        }
      })
    }

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
      const name   = container.querySelector('#h-name').value.trim()
      const emoji  = container.querySelector('#h-emoji').value
      const desc   = container.querySelector('#h-desc').value
      const reminder_time = container.querySelector('#h-reminder')?.value || null
      const freq   = isEdit ? habit.frequency
        : container.querySelector('input[name="freq"]:checked')?.value || 'daily'
      const targetEl = container.querySelector('#h-target')
      const target_count = (freq === 'weekly' && targetEl) ? Number(targetEl.value) : undefined

      if (!name) { alert('Name is required'); return }
      if (target_count !== undefined && (target_count < 1 || target_count > 7)) {
        alert('Times per week must be between 1 and 7'); return
      }
      try {
        if (isEdit) {
          await api.put(`/habits/${habit.id}`, { name, emoji, description: desc, color: selectedColor, target_count, reminder_time })
        } else {
          await api.post('/habits', { name, emoji, description: desc, color: selectedColor, frequency: freq, target_count, reminder_time })
        }
        await refreshHabits()
        view = 'list'; renderList()
      } catch (err) {
        alert(err.message || 'Error saving habit')
      }
    }

    const testReminderBtn = container.querySelector('#h-test-reminder')
    if (testReminderBtn) {
      testReminderBtn.onclick = async () => {
        try {
          await api.post(`/habits/${habit.id}/test-reminder`, {})
          const toast = document.createElement('span')
          toast.textContent = 'Test notification sent!'
          toast.style.cssText = 'margin-left:.75rem;font-size:.85rem;color:#10b981'
          testReminderBtn.insertAdjacentElement('afterend', toast)
          setTimeout(() => toast.remove(), 3000)
        } catch (err) {
          const toast = document.createElement('span')
          toast.textContent = `Failed: ${err.message || 'Error'}`
          toast.style.cssText = 'margin-left:.75rem;font-size:.85rem;color:#ef4444'
          testReminderBtn.insertAdjacentElement('afterend', toast)
          setTimeout(() => toast.remove(), 3000)
        }
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
          <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:.9rem 1rem;background:#1e293b;border-radius:8px;margin-bottom:.5rem">
            <div>
              <div style="font-weight:600;color:#f1f5f9">${h.emoji ? esc(h.emoji) + ' ' : ''}${esc(h.name)}</div>
              <div style="font-size:.75rem;color:#64748b;margin-top:.25rem">
                ${h.archived_at ? 'Archived ' + new Date(h.archived_at).toLocaleDateString() : 'Archive date unknown'}
              </div>
              <div style="font-size:.8rem;color:#94a3b8;margin-top:.4rem">
                &#11088; ${h.longestStreak ?? 0} best &nbsp;&middot;&nbsp; ${h.completionRate30d ?? 0}% (30d) &nbsp;&middot;&nbsp; ${h.totalCompletions ?? 0} total
              </div>
            </div>
            <button class="h-restore" data-id="${h.id}" style="padding:.4rem .9rem;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:6px;cursor:pointer;font-size:.85rem;flex-shrink:0">Restore</button>
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
