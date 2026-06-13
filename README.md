# mosaic-module-habits

Daily and weekly habit tracker for the Mosaic framework. Define habits, log completions, track streaks, and review progress on a month calendar. Completed habits appear in the Calendar module and contribute to the Reports page.

---

## Features

| Feature | Detail |
|---|---|
| Habits | Create daily or weekly habits with name, description, colour, and emoji |
| Logging | Mark a habit done for any date; add optional notes per log |
| Streaks | Longest streak and current streak calculated per habit |
| Today status | Each habit shows whether it has been logged today |
| Calendar view | Month grid showing completion days for each habit |
| Archive | Archive habits without deleting their logs |
| Badge | Nav badge shows count of habits not yet logged today |
| Notifications | Framework sends reminders for habits not completed by midday |
| Reports | Weekly and monthly completion summaries for the Reports page |

---

## API

Base path: `/api/habits/`

### Habits

| Method | Path | Description |
|---|---|---|
| `GET` | `/habits` | List habits with streak and today's log status (`include_archived` param) |
| `POST` | `/habits` | Create habit (`name`, `frequency`: `daily`\|`weekly`, `description`, `color`, `emoji`) |
| `GET` | `/habits/:id` | Get habit with last 30 log entries |
| `PUT` | `/habits/:id` | Update habit (`name`, `description`, `color`, `emoji`, `active`, `sort_order`) |
| `DELETE` | `/habits/:id` | Archive habit |

### Logs

| Method | Path | Description |
|---|---|---|
| `GET` | `/habits/:id/logs` | Get logs for a habit (`month` param: `YYYY-MM`) |
| `POST` | `/habits/:id/logs` | Log completion (`date`: `YYYY-MM-DD`, `notes`) |
| `DELETE` | `/habits/:id/logs/:date` | Remove a log entry |

### Calendar and Reports

| Method | Path | Description |
|---|---|---|
| `GET` | `/calendar` | Habit logs for a given month (`year`, `month` params) — used by Calendar module |
| `GET` | `/reports/weekly` | Completion summary for a date range (`start`, `end`) |
| `GET` | `/reports/summary` | Today's count: habits logged vs total due |

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `better-sqlite3` | peer | SQLite driver (provided by framework) |
| `express` | peer | HTTP server (provided by framework) |
| `@opentelemetry/api` | peer | Observability (provided by framework) |

---

## Project structure

```
mosaic-module-habits/
├── index.ts            # Module manifest — slug, nav badge, notification hooks, report hooks
├── src/
│   ├── routes/
│   │   └── index.ts    # Full habits router + /ui.js
│   └── services/       # Streak calculation, log queries
├── public/
│   └── ui.js           # Frontend IIFE — served via GET /api/habits/ui.js
└── tests/
    └── unit/           # Vitest unit tests
```
