import type { ReportHooks, ModuleContext } from '@mosaic/sdk'
import {
  getWeeklyHabits,
  getHabitSummary,
  getDetailedHabitsReport,
} from '../services/reports.service.js'

export const reportHooks: ReportHooks = {
  weekly(ctx: ModuleContext, userId: number, start: string, end: string) {
    return getWeeklyHabits(ctx.db.raw, userId, start, end)
  },
  summary(ctx: ModuleContext, userId: number) {
    const today = new Date().toISOString().slice(0, 10)
    return getHabitSummary(ctx.db.raw, userId, today)
  },
  detailed(ctx: ModuleContext, userId: number, start: string, end: string) {
    const today = new Date().toISOString().slice(0, 10)
    return getDetailedHabitsReport(ctx.db.raw, userId, start, end, today)
  },
}
