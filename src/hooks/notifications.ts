import type { NotificationHooks, ModuleContext } from '@mosaic/sdk'
import { getDueHabits } from '../services/reports.service.js'

export const notificationHooks: NotificationHooks = {
  dueSoon(ctx: ModuleContext, userId: number, date: string) {
    return getDueHabits(ctx.db.raw, userId, date)
  },
}
